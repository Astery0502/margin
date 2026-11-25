package main

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"path/filepath"
	"strings"
)

// Keep the API key in a separate vault so ChatGPT sign-in and revocation have independent lifetimes.
func (p provider) deepseek(ctx context.Context, cmd command, send func(any) error) error {
	v := vault{filepath.Join(p.vault.directory, "DeepSeek")}
	var key string
	var generation int
	err := v.transaction(ctx, func(s *state) (bool, error) {
		generation = s.Generation
		if s.Session != nil {
			key = s.Session.Access
		}
		if cmd.Op == "deepseek-logout" {
			s.Session = nil
			s.Generation++
			return true, nil
		}
		return false, nil
	})
	if err != nil {
		return err
	}
	switch cmd.Op {
	case "deepseek-status":
		return send(message{"connected": key != "", "selected": "deepseek", "generation": generation})
	case "deepseek-logout":
		return send(message{"done": true})
	case "deepseek-login":
		key = strings.TrimSpace(cmd.Key)
		if key == "" || strings.ContainsAny(key, "\r\n") {
			return errors.New("Enter a DeepSeek API key.")
		}
	case "deepseek-models":
		if key == "" {
			return send(message{"connected": false})
		}
	case "deepseek-response":
		if key == "" || cmd.Generation != generation {
			return errors.New("The DeepSeek connection changed. Check your connection and try again.")
		}
	default:
		return errors.New("Unsupported DeepSeek operation.")
	}

	method, path := "GET", "/models"
	var body io.Reader
	if cmd.Op == "deepseek-response" {
		var params struct {
			Model  string
			Stream bool
		}
		if json.Unmarshal([]byte(cmd.Body), &params) != nil || params.Model == "" || !params.Stream {
			return errors.New("Invalid DeepSeek streaming request.")
		}
		var cancel context.CancelFunc
		ctx, cancel = context.WithCancel(ctx)
		defer cancel()
		go v.watchSession(ctx, cancel, generation)
		method, path, body = "POST", "/chat/completions", strings.NewReader(cmd.Body)
	}
	req, err := http.NewRequestWithContext(ctx, method, "https://api.deepseek.com"+path, body)
	if err != nil {
		return err
	}
	req.Header.Set("Authorization", "Bearer "+key)
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
		req.Header.Set("Accept", "text/event-stream")
	}
	res, err := p.client.Do(req)
	if err != nil {
		return connectionError(err, "Margin Connect could not reach DeepSeek.")
	}
	defer res.Body.Close()
	if res.StatusCode != http.StatusOK {
		msg := fmt.Sprintf("DeepSeek returned HTTP %d. Check your model access and usage limits.", res.StatusCode)
		switch res.StatusCode {
		case 401:
			msg = "DeepSeek declined the API key. Check the key in connection settings."
		case 402:
			msg = "Your DeepSeek API balance is insufficient."
		}
		return &providerHTTPError{res.StatusCode, msg}
	}
	if cmd.Op == "deepseek-response" {
		return streamFrames(res, send, "DeepSeek")
	}
	var list struct {
		Data []struct{ ID string }
	}
	if json.NewDecoder(io.LimitReader(res.Body, 4<<20)).Decode(&list) != nil || list.Data == nil {
		return errors.New("DeepSeek returned an unreadable model list.")
	}
	if cmd.Op == "deepseek-login" {
		err := v.transaction(ctx, func(s *state) (bool, error) {
			if s.Generation != generation {
				return false, errors.New("The DeepSeek connection changed. Try again.")
			}
			s.Session = &session{Access: key}
			s.Generation++
			return true, nil
		})
		if err != nil {
			return err
		}
		return send(message{"done": true})
	}
	ids := []string{}
	for _, model := range list.Data {
		ids = append(ids, model.ID)
	}
	return send(message{"connected": true, "modelIds": ids})
}
