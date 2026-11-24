package main

import (
	"context"
	"encoding/binary"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"time"
)

var origins string // Filled from the extension manifest at build time.
const hostName = "dev.margin.connect"

type command struct {
	Op, Body, Account string
	Generation        int
}
type message = map[string]any

func frame(value any) error {
	data, err := json.Marshal(value)
	if err != nil {
		return err
	}
	if len(data) > 1024*1024 {
		return errors.New("The native reply is too large.")
	}
	if err = binary.Write(os.Stdout, binary.LittleEndian, uint32(len(data))); err != nil {
		return err
	}
	_, err = os.Stdout.Write(data)
	return err
}
func readCommand(reader io.Reader) (command, error) {
	var size uint32
	var cmd command
	if err := binary.Read(reader, binary.LittleEndian, &size); err != nil {
		return cmd, err
	}
	if size == 0 || size > 64<<20 {
		return cmd, errors.New("Native request exceeds the supported size.")
	}
	data := make([]byte, size)
	if _, err := io.ReadFull(reader, data); err != nil {
		return cmd, err
	}
	err := json.Unmarshal(data, &cmd)
	return cmd, err
}
func (p provider) api(ctx context.Context, cmd command, send func(any) error) error {
	op, body := cmd.Op, cmd.Body
	access, err := p.access(ctx, cmd.Generation, op == "response")
	if err != nil {
		return err
	}
	if access == "" {
		if op == "models" {
			return send(message{"connected": false})
		}
		return errors.New("Connect your ChatGPT account before sending.")
	}
	method, path := "GET", "/models"
	var content io.Reader
	if op == "response" {
		var payload map[string]json.RawMessage
		if json.Unmarshal([]byte(body), &payload) != nil || payload["model"] == nil {
			return errors.New("Invalid model request.")
		}
		payload["stream"] = json.RawMessage("true")
		payload["store"] = json.RawMessage("false")
		for _, field := range strings.Fields("background conversation max_output_tokens max_tool_calls metadata moderation multi_agent prompt prompt_cache_retention prompt_cache_options safety_identifier temperature top_logprobs top_p truncation user previous_response_id") {
			delete(payload, field)
		}
		var cancel context.CancelFunc
		ctx, cancel = context.WithCancel(ctx)
		defer cancel()
		go p.vault.watchSession(ctx, cancel, cmd.Generation)
		encoded, err := json.Marshal(payload)
		if err != nil {
			return err
		}
		content = strings.NewReader(string(encoded))
		method = "POST"
		path = "/responses"
	}
	req, err := http.NewRequestWithContext(ctx, method, p.resource+path, content)
	if err != nil {
		return err
	}
	req.Header.Set("Authorization", "Bearer "+access)
	if op == "response" {
		req.Header.Set("Content-Type", "application/json")
		req.Header.Set("Accept", "text/event-stream")
	}
	res, err := p.client.Do(req)
	if err != nil {
		return errors.New("Margin Connect could not reach OpenAI.")
	}
	defer res.Body.Close()
	if res.StatusCode == 401 {
		err = p.vault.transaction(ctx, func(s *state) (bool, error) {
			if s.Session != nil && s.Session.Access == access {
				s.Session.Expires = time.Time{}
				return true, nil
			}
			return false, nil
		})
		if err != nil {
			return err
		}
		return errors.New("OpenAI declined this session. Try again to refresh it, or reconnect in settings.")
	}
	if res.StatusCode != 200 {
		return fmt.Errorf("OpenAI returned HTTP %d. Check the account's model access and usage limits.", res.StatusCode)
	}
	if op == "models" {
		var list struct {
			Models []struct {
				Slug, Visibility string
				Name             string `json:"display_name"`
			}
		}
		if json.NewDecoder(io.LimitReader(res.Body, 4<<20)).Decode(&list) != nil || list.Models == nil {
			return errors.New("OpenAI returned an unreadable model list.")
		}
		ids := []string{}
		names := map[string]string{}
		for _, m := range list.Models {
			if m.Visibility == "list" && m.Slug != "" {
				ids = append(ids, m.Slug)
				names[m.Slug] = m.Name
			}
		}
		return send(message{"connected": true, "modelIds": ids, "names": names})
	}
	if !strings.HasPrefix(res.Header.Get("Content-Type"), "text/event-stream") {
		return errors.New("OpenAI did not return a streaming response.")
	}
	if err = send(message{"start": true}); err != nil {
		return err
	}
	buf := make([]byte, 32<<10)
	for {
		n, err := res.Body.Read(buf)
		if n > 0 {
			if e := send(message{"chunk": buf[:n]}); e != nil {
				return e
			}
		}
		if err == io.EOF {
			break
		}
		if err != nil {
			return errors.New("The response stream was interrupted.")
		}
	}
	return send(message{"done": true})
}
func (p provider) operate(ctx context.Context, cmd command, send func(any) error) error {
	switch cmd.Op {
	case "status":
		var status message
		err := p.vault.transaction(ctx, func(s *state) (bool, error) {
			accounts := []message{}
			for _, r := range s.Accounts {
				accounts = append(accounts, message{"id": r.ClientID, "email": r.Email})
			}
			status = message{"connected": s.Session != nil, "email": s.Registration.Email, "accounts": accounts, "selected": s.Registration.ClientID, "generation": s.Generation}
			return false, nil
		})
		if err != nil {
			return err
		}
		return send(status)
	case "login":
		if err := p.login(ctx, cmd.Account, send); err != nil {
			return err
		}
		return send(message{"done": true})
	case "logout":
		confirmed, err := p.logout(ctx)
		if err != nil {
			return err
		}
		return send(message{"revoked": confirmed})
	case "response", "models":
		return p.api(ctx, cmd, send)
	default:
		return errors.New("Unsupported Margin Connect operation.")
	}
}
func main() {
	home, err := os.UserHomeDir()
	if err != nil {
		return
	}
	support := filepath.Join(home, "Library", "Application Support")
	if len(os.Args) == 1 || strings.HasPrefix(os.Args[1], "-psn_") {
		setupWindow(support)
		return
	}
	client := &http.Client{CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}
	p := provider{issuer, resource, client, vault{filepath.Join(support, "Margin", "Connect")}}
	runNative(p)
}

func runNative(p provider) {
	if !slices.Contains(strings.Fields(origins), os.Args[1]) {
		return
	}
	cmd, err := readCommand(os.Stdin)
	if err != nil {
		return
	}
	limit := 45 * time.Second
	if cmd.Op == "login" {
		limit = 5 * time.Minute
	}
	if cmd.Op == "response" {
		limit = 30 * time.Minute
	}
	ctx, cancel := context.WithTimeout(context.Background(), limit)
	defer cancel()
	// Closing the extension port must stop the callback listener or upstream model request.
	go func() { var b [1]byte; os.Stdin.Read(b[:]); cancel() }()
	if err = p.operate(ctx, cmd, frame); err != nil {
		frame(message{"error": err.Error()})
	}
}
