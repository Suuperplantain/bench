package codex

import (
	"bufio"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os/exec"
	"strings"
	"sync/atomic"
)

// Event is a small, UI-facing subset of Codex App Server's JSON-RPC stream.
type Event struct {
	Type     string `json:"type"`
	ThreadID string `json:"thread_id,omitempty"`
	Text     string `json:"text,omitempty"`
	Approval *ApprovalRequest `json:"approval,omitempty"`
}

// ApprovalRequest contains the operation the person must review before Codex
// receives more access than the selected repository sandbox grants.
type ApprovalRequest struct {
	ID string `json:"id,omitempty"`
	Kind string `json:"kind"`
	Reason string `json:"reason,omitempty"`
	Command string `json:"command,omitempty"`
	CWD string `json:"cwd,omitempty"`
	Target string `json:"target,omitempty"`
	Permissions json.RawMessage `json:"permissions,omitempty"`
}

type wireMessage struct {
	ID     json.RawMessage `json:"id"`
	Method string          `json:"method"`
	Params json.RawMessage `json:"params"`
	Result json.RawMessage `json:"result"`
	Error  *struct {
		Message string `json:"message"`
	} `json:"error"`
}

type AppServer struct {
	Command string
	sequence atomic.Int64
}

func New() *AppServer { return &AppServer{Command: "codex"} }

// RunTurn starts one local app-server connection, creates/resumes the repo's
// persisted thread, and streams this turn until Codex reports completion.
func (server *AppServer) RunTurn(ctx context.Context, cwd, threadID, prompt string, emit func(Event), approve func(context.Context, ApprovalRequest) bool) (string, error) {
	command := server.Command
	if command == "" { command = "codex" }
	status := exec.CommandContext(ctx, command, "login", "status")
	loginOutput, loginErr := status.CombinedOutput()
	if loginErr != nil {
		message := strings.TrimSpace(string(loginOutput))
		if message == "" { message = "Not logged in" }
		return "", authFriendly(errors.New(message))
	}
	cmd := exec.CommandContext(ctx, command, "app-server", "--listen", "stdio://",
		"-c", `windows.sandbox="elevated"`,
		"-c", "features.apps=false",
		"-c", "features.plugins=false",
		"-c", "web_search=\"disabled\"",
		"-c", "mcp_servers={}",
		"-c", `default_permissions="bench_repo"`,
		"-c", `permissions.bench_repo={extends=":workspace",filesystem={":root"="deny",":minimal"="read",":tmpdir"="deny",":slash_tmp"="deny",":workspace_roots"={"."="write"}},network={enabled=false}}`)
	stdin, err := cmd.StdinPipe()
	if err != nil { return "", fmt.Errorf("start Codex app server: %w", err) }
	stdout, err := cmd.StdoutPipe()
	if err != nil { return "", fmt.Errorf("read Codex app server: %w", err) }
	var stderr strings.Builder
	cmd.Stderr = &stderr
	if err := cmd.Start(); err != nil { return "", fmt.Errorf("start Codex app server: %w", err) }
	defer func() { _ = stdin.Close(); _ = cmd.Wait() }()

	messages := make(chan wireMessage, 128)
	readErr := make(chan error, 1)
	go func() {
		scanner := bufio.NewScanner(stdout)
		scanner.Buffer(make([]byte, 64*1024), 8*1024*1024)
		for scanner.Scan() {
			var message wireMessage
			if err := json.Unmarshal(scanner.Bytes(), &message); err != nil { readErr <- fmt.Errorf("read Codex response: %w", err); return }
			messages <- message
		}
		if err := scanner.Err(); err != nil { readErr <- err; return }
		readErr <- io.EOF
	}()

	write := func(method string, id int64, params any) error {
		request := map[string]any{"method": method, "params": params}
		if id > 0 { request["id"] = id }
		data, err := json.Marshal(request)
		if err != nil { return err }
		_, err = fmt.Fprintln(stdin, string(data))
		return err
	}
	request := func(method string, params any) (wireMessage, error) {
		id := server.sequence.Add(1)
		if err := write(method, id, params); err != nil { return wireMessage{}, err }
		for {
			select {
			case <-ctx.Done(): return wireMessage{}, ctx.Err()
			case err := <-readErr: return wireMessage{}, fmt.Errorf("Codex app server stopped: %w", err)
			case message := <-messages:
				if message.Method != "" && len(message.ID) != 0 { if err := respondToServerRequest(ctx, stdin, message, approve); err != nil { return wireMessage{}, err }; continue }
				if len(message.ID) == 0 { continue }
				var responseID int64
				_ = json.Unmarshal(message.ID, &responseID)
				if responseID != id { continue }
				if message.Error != nil { return wireMessage{}, errors.New(message.Error.Message) }
				return message, nil
			}
		}
	}

	if _, err := request("initialize", map[string]any{"clientInfo": map[string]string{"name": "bench", "title": "Bench", "version": "0.2.0"}, "capabilities": map[string]bool{"experimentalApi": true}}); err != nil { return "", authFriendly(err) }
	if err := write("initialized", 0, map[string]any{}); err != nil { return "", err }

	threadParams := map[string]any{
		"cwd": cwd, "permissions": "bench_repo", "approvalPolicy": "on-request",
		"developerInstructions": "You are working inside Bench on the selected repository. Keep code changes focused on this repository, follow the user's requests, and run relevant checks. Ask for approval before accessing files or services outside the repository sandbox. Use the local Git identity; never invent or change the author identity. Commit or push only when the user requests it.",
	}
	method := "thread/start"
	if threadID != "" {
		method = "thread/resume"
		threadParams["threadId"] = threadID
	}
	threadResponse, err := request(method, threadParams)
	if err != nil { return "", authFriendly(err) }
	var threadPayload struct { Thread struct { ID string `json:"id"` } `json:"thread"` }
	if err := json.Unmarshal(threadResponse.Result, &threadPayload); err != nil || threadPayload.Thread.ID == "" { return "", errors.New("Codex did not return a repository chat thread") }
	threadID = threadPayload.Thread.ID
	if emit != nil { emit(Event{Type: "thread", ThreadID: threadID}) }

	_, err = request("turn/start", map[string]any{
		"threadId": threadID,
		"cwd": cwd,
		"input": []map[string]string{{"type": "text", "text": prompt}},
		"permissions": "bench_repo",
		"approvalPolicy": "on-request",
	})
	if err != nil { return threadID, authFriendly(err) }
	for {
		select {
		case <-ctx.Done(): return threadID, ctx.Err()
		case err := <-readErr: return threadID, fmt.Errorf("Codex app server stopped: %w", err)
		case message := <-messages:
			if len(message.ID) != 0 { if err := respondToServerRequest(ctx, stdin, message, approve); err != nil { return threadID, err }; continue }
			switch message.Method {
			case "item/agentMessage/delta":
				var params struct { ThreadID string `json:"threadId"`; Delta string `json:"delta"` }
				if json.Unmarshal(message.Params, &params) == nil && params.ThreadID == threadID && params.Delta != "" && emit != nil { emit(Event{Type: "delta", Text: params.Delta}) }
			case "turn/completed":
				var params struct { ThreadID string `json:"threadId"`; Turn struct { Status string `json:"status"`; Error *struct { Message string `json:"message"` } `json:"error"` } `json:"turn"` }
				if json.Unmarshal(message.Params, &params) == nil && params.ThreadID == threadID {
					if params.Turn.Error != nil { return threadID, errors.New(params.Turn.Error.Message) }
					if params.Turn.Status == "failed" { return threadID, errors.New("Codex turn failed") }
					if emit != nil { emit(Event{Type: "done"}) }
					return threadID, nil
				}
			}
		}
	}
}

func respondToServerRequest(ctx context.Context, stdin io.Writer, message wireMessage, approve func(context.Context, ApprovalRequest) bool) error {
	if len(message.ID) == 0 { return nil }
	result := any(nil)
	switch message.Method {
	case "item/commandExecution/requestApproval", "item/fileChange/requestApproval":
		request := approvalRequest(message)
		decision := "decline"
		if approve != nil && (request.Command != "" || request.Target != "") && approve(ctx, request) { decision = "accept" }
		result = map[string]any{"decision": decision}
	case "item/permissions/requestApproval":
		request := approvalRequest(message)
		if approve != nil && approve(ctx, request) && len(request.Permissions) > 0 {
			result = map[string]any{"permissions": request.Permissions, "scope": "turn"}
		} else { result = map[string]any{"permissions": map[string]any{}} }
	case "mcpServer/elicitation/request":
		result = map[string]any{"action": "decline", "content": nil}
	}
	response := map[string]any{"id": json.RawMessage(message.ID)}
	if result != nil { response["result"] = result } else { response["error"] = map[string]any{"code": -32000, "message": "Unsupported request from Codex App Server."} }
	data, err := json.Marshal(response)
	if err != nil { return err }
	_, err = fmt.Fprintln(stdin, string(data))
	return err
}

func approvalRequest(message wireMessage) ApprovalRequest {
	var params struct {
		Reason string `json:"reason"`
		Command string `json:"command"`
		CWD string `json:"cwd"`
		GrantRoot string `json:"grantRoot"`
		Permissions json.RawMessage `json:"permissions"`
		NetworkApprovalContext struct { Host string `json:"host"`; Protocol string `json:"protocol"` } `json:"networkApprovalContext"`
	}
	_ = json.Unmarshal(message.Params, &params)
	request := ApprovalRequest{Kind: message.Method, Reason: params.Reason, Command: params.Command, CWD: params.CWD, Permissions: params.Permissions}
	if params.GrantRoot != "" { request.Target = params.GrantRoot }
	if params.NetworkApprovalContext.Host != "" { request.Target = params.NetworkApprovalContext.Protocol + "://" + params.NetworkApprovalContext.Host }
	return request
}

func authFriendly(err error) error {
	if err == nil { return nil }
	message := strings.ToLower(err.Error())
	if strings.Contains(message, "windows sandbox wrapper") || strings.Contains(message, "split filesystem read restrictions") {
		return errors.New("Bench needs the elevated Codex Windows sandbox before repository chat can run safely. Set up Agent sandbox in Codex, then retry. Bench will not fall back to broad file access.")
	}
	if strings.Contains(message, "not logged in") || strings.Contains(message, "unauthorized") || strings.Contains(message, "authentication") {
		return errors.New("Codex isn’t logged in on this machine. Run `codex login`, then try the chat again.")
	}
	return err
}
