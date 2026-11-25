package main

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/url"
	"slices"
	"strings"
	"time"

	"github.com/coreos/go-oidc/v3/oidc"
)

const issuer = "https://auth.openai.com"
const resource = "https://api.openai.com/v1"
const planScope = "chatgpt.tokens.use.direct"
const dynamicClient = "dynamic_agent_client"

type provider struct {
	issuer, resource string
	client           *http.Client
	vault            vault
}
type tokenReply struct {
	Access  string `json:"access_token"`
	Refresh string `json:"refresh_token"`
	ID      string `json:"id_token"`
	Scope   string `json:"scope"`
	Type    string `json:"token_type"`
	Expires int    `json:"expires_in"`
	Error   string `json:"error"`
}

var invalidGrant = errors.New("Your ChatGPT session expired. Connect again.")

func (p provider) token(ctx context.Context, form url.Values) (tokenReply, error) {
	ctx, cancel := context.WithTimeout(ctx, 12*time.Second)
	defer cancel()
	var t tokenReply
	form.Set("resource", p.resource)
	req, err := http.NewRequestWithContext(ctx, "POST", p.issuer+"/api/accounts/oauth/token", strings.NewReader(form.Encode()))
	if err != nil {
		return t, err
	}
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	res, err := p.client.Do(req)
	if err != nil {
		return t, errors.New("Could not reach OpenAI to authorize this account.")
	}
	defer res.Body.Close()
	if json.NewDecoder(io.LimitReader(res.Body, 1<<20)).Decode(&t) != nil {
		return t, errors.New("OpenAI returned an unreadable authorization response.")
	}
	if slices.Contains(strings.Fields("invalid_grant invalid_refresh_token token_expired refresh_token_expired refresh_token_invalidated refresh_token_reused"), t.Error) {
		return t, invalidGrant
	}
	if res.StatusCode != 200 || t.Access == "" || t.Expires <= 0 || !strings.EqualFold(t.Type, "Bearer") {
		return t, errors.New("OpenAI did not issue a usable access token.")
	}
	return t, nil
}
func (t tokenReply) session(previous *session) (*session, error) {
	if previous != nil {
		if t.Scope == "" {
			t.Scope = previous.Scope
		}
		if t.Refresh == "" {
			t.Refresh = previous.Refresh
		}
	}
	if t.Refresh == "" || !slices.Contains(strings.Fields(t.Scope), planScope) {
		return nil, errors.New("Enable ChatGPT plan access during sign-in and try again.")
	}
	return &session{t.Access, t.Refresh, t.Scope, time.Now().Add(time.Duration(t.Expires) * time.Second)}, nil
}
func hostID() string {
	var b [16]byte
	rand.Read(b[:])
	b[6] = (b[6] & 15) | 64
	b[8] = (b[8] & 63) | 128
	return fmt.Sprintf("urn:uuid:%x-%x-%x-%x-%x", b[0:4], b[4:6], b[6:8], b[8:10], b[10:16])
}
func (p provider) login(ctx context.Context, accountID string, send func(any) error) error {
	var id string
	var previous registration
	var generation int
	err := p.vault.transaction(ctx, func(s *state) (bool, error) {
		fresh := s.HostID == ""
		if fresh {
			s.HostID = hostID()
		}
		id = s.HostID
		generation = s.Generation
		if s.Session != nil {
			return false, errors.New("Disconnect the current account before signing in.")
		}
		if accountID == "" {
			previous.ClientID = s.PendingClient
		} else {
			idx := slices.IndexFunc(s.Accounts, func(r registration) bool { return r.ClientID == accountID })
			if idx < 0 {
				return false, errors.New("Choose a saved account.")
			}
			previous = s.Accounts[idx]
		}
		return fresh, nil
	})
	if err != nil {
		return err
	}
	clientID := previous.ClientID
	if clientID == "" {
		clientID = dynamicClient
	}
	listener, err := net.Listen("tcp4", "127.0.0.1:0")
	if err != nil {
		return errors.New("Could not open the local sign-in callback.")
	}
	defer listener.Close()
	callback := "http://" + listener.Addr().String() + "/auth/callback"
	verifier := base64.RawURLEncoding.EncodeToString(randomBytes(32))
	digest := sha256.Sum256([]byte(verifier))
	stateID, nonce := rand.Text(), rand.Text()
	params := url.Values{"client_id": {clientID}, "ext_agent_host_id": {id}, "resource": {p.resource}, "response_type": {"code"}, "redirect_uri": {callback}, "scope": {"openid profile email offline_access resource.invoke " + planScope}, "state": {stateID}, "nonce": {nonce}, "code_challenge_method": {"S256"}, "code_challenge": {base64.RawURLEncoding.EncodeToString(digest[:])}}
	if clientID == dynamicClient {
		params.Set("agent_name_hint", "Margin")
	} else if previous.Email != "" {
		params.Set("login_hint", previous.Email)
	}
	received := make(chan url.Values, 1)
	server := http.Server{ReadHeaderTimeout: 3 * time.Second, WriteTimeout: 5 * time.Second, MaxHeaderBytes: 8192, Handler: http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Cache-Control", "no-store")
		w.Header().Set("Referrer-Policy", "no-referrer")
		if r.Method != "GET" || r.Host != listener.Addr().String() || r.URL.Path != "/auth/callback" || r.URL.Query().Get("state") != stateID {
			http.Error(w, "Invalid sign-in callback.", 400)
			return
		}
		select {
		case received <- r.URL.Query():
			fmt.Fprint(w, "Return to Margin to finish connecting.")
		default:
			http.Error(w, "This sign-in attempt has finished.", 410)
		}
	})}
	go server.Serve(listener)
	defer server.Shutdown(context.Background())
	if err = send(map[string]string{"authorize": p.issuer + "/api/accounts/authorize?" + params.Encode()}); err != nil {
		return err
	}
	var q url.Values
	select {
	case <-ctx.Done():
		return errors.New("Sign-in timed out. Try again.")
	case q = <-received:
	}
	if q.Has("error") || q.Get("code") == "" {
		return errors.New("Sign-in was cancelled or declined.")
	}
	issued := q.Get("client_id")
	if clientID != dynamicClient {
		if issued != "" && issued != clientID {
			return errors.New("The returning registration did not match.")
		}
		issued = clientID
	}
	if issued == "" || issued == dynamicClient {
		return errors.New("OpenAI did not return an app registration.")
	}
	if clientID == dynamicClient {
		err = p.vault.transaction(ctx, func(s *state) (bool, error) {
			if s.Generation != generation || s.Session != nil {
				return false, errors.New("The account changed. Try again.")
			}
			s.PendingClient = issued
			return true, nil
		})
		if err != nil {
			return err
		}
	}
	t, err := p.token(ctx, url.Values{"grant_type": {"authorization_code"}, "code": {q.Get("code")}, "client_id": {issued}, "code_verifier": {verifier}, "redirect_uri": {callback}})
	if err != nil {
		return err
	}
	ctx = oidc.ClientContext(ctx, p.client)
	discovery, err := oidc.NewProvider(ctx, p.issuer)
	if err != nil {
		return errors.New("Could not verify OpenAI's sign-in configuration.")
	}
	identity, err := discovery.Verifier(&oidc.Config{ClientID: issued}).Verify(ctx, t.ID)
	if err != nil || identity.Nonce != nonce || identity.Subject == "" || (previous.Subject != "" && identity.Subject != previous.Subject) {
		return errors.New("The identity returned by OpenAI could not be verified.")
	}
	var claims struct{ Email string }
	if err = identity.Claims(&claims); err != nil {
		return errors.New("Could not verify the account details.")
	}
	credentials, planError := t.session(nil)
	return p.vault.transaction(ctx, func(s *state) (bool, error) {
		if s.Generation != generation || s.Session != nil {
			return false, errors.New("Account changed during sign-in. Disconnect before switching accounts.")
		}
		s.Registration = registration{issued, identity.Subject, claims.Email}
		if s.PendingClient == issued {
			s.PendingClient = ""
		}
		s.Session = credentials
		s.Generation++
		idx := slices.IndexFunc(s.Accounts, func(r registration) bool { return r.ClientID == issued })
		if idx < 0 {
			s.Accounts = append(s.Accounts, s.Registration)
		} else {
			s.Accounts[idx] = s.Registration
		}
		return true, planError
	})
}
func randomBytes(n int) []byte { b := make([]byte, n); rand.Read(b); return b }
func (p provider) access(ctx context.Context, generation int, bound bool) (string, error) {
	var access string
	err := p.vault.transaction(ctx, func(s *state) (bool, error) {
		if s.Session == nil {
			return false, nil
		}
		if bound && generation != s.Generation {
			return false, errors.New("The ChatGPT account changed. Send again to start a new request.")
		}
		if time.Until(s.Session.Expires) > time.Minute {
			access = s.Session.Access
			return false, nil
		}
		t, err := p.token(ctx, url.Values{"grant_type": {"refresh_token"}, "client_id": {s.Registration.ClientID}, "refresh_token": {s.Session.Refresh}})
		if errors.Is(err, invalidGrant) {
			s.Session = nil
			s.Generation++
			return true, err
		}
		if err != nil {
			return false, err
		}
		next, err := t.session(s.Session)
		if err != nil {
			s.Session = nil
			s.Generation++
			return true, err
		}
		s.Session = next
		access = next.Access
		return true, nil
	})
	return access, err
}
func (p provider) logout(ctx context.Context) (bool, error) {
	var clientID, refresh string
	err := p.vault.transaction(ctx, func(s *state) (bool, error) {
		s.Generation++
		if s.Session != nil {
			clientID = s.Registration.ClientID
			refresh = s.Session.Refresh
			s.Session = nil
		}
		return true, nil
	})
	if err != nil {
		return false, err
	}
	if refresh == "" {
		return true, nil
	}
	return p.revoke(ctx, clientID, refresh), nil
}
func (p provider) revoke(ctx context.Context, id, refresh string) bool {
	ctx, cancel := context.WithTimeout(ctx, 12*time.Second)
	defer cancel()
	d, err := oidc.NewProvider(oidc.ClientContext(ctx, p.client), p.issuer)
	if err != nil {
		return false
	}
	var meta struct {
		Endpoint string `json:"revocation_endpoint"`
	}
	if d.Claims(&meta) != nil || !strings.HasPrefix(meta.Endpoint, p.issuer+"/") {
		return false
	}
	form := url.Values{"token": {refresh}, "token_type_hint": {"refresh_token"}, "client_id": {id}}
	for attempt := 0; attempt < 2; attempt++ {
		req, err := http.NewRequestWithContext(ctx, "POST", meta.Endpoint, strings.NewReader(form.Encode()))
		if err != nil {
			return false
		}
		req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
		res, err := p.client.Do(req)
		if err == nil {
			res.Body.Close()
			if res.StatusCode == 200 {
				return true
			}
			if res.StatusCode < 500 {
				return false
			}
		}
		select {
		case <-ctx.Done():
			return false
		case <-time.After(300 * time.Millisecond):
		}
	}
	return false
}
