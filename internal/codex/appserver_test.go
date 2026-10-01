package codex

import (
	"bytes"
	"context"
	"encoding/json"
	"strings"
	"testing"
)

func TestApprovalResponseOnlyAcceptsOneRequest(t *testing.T) {
	message := wireMessage{
		ID: json.RawMessage(`7`),
		Method: "item/commandExecution/requestApproval",
		Params: json.RawMessage(`{"reason":"Install dependencies","command":"go mod download","cwd":"C:/work/repo"}`),
	}
	var output bytes.Buffer
	called := false
	err := respondToServerRequest(context.Background(), &output, message, func(_ context.Context, request ApprovalRequest) bool {
		called = true
		if request.Command != "go mod download" || request.CWD != "C:/work/repo" { t.Fatalf("request details = %+v", request) }
		return true
	})
	if err != nil { t.Fatal(err) }
	if !called || !strings.Contains(output.String(), `"decision":"accept"`) { t.Fatalf("approval response = %q", output.String()) }
	if strings.Contains(output.String(), "acceptForSession") { t.Fatal("approval must be for one request only") }
}

func TestUnsupportedServerRequestFailsClosed(t *testing.T) {
	message := wireMessage{ID: json.RawMessage(`8`), Method: "unknown/request"}
	var output bytes.Buffer
	if err := respondToServerRequest(context.Background(), &output, message, nil); err != nil { t.Fatal(err) }
	if !strings.Contains(output.String(), `"error"`) || strings.Contains(output.String(), `"result"`) { t.Fatalf("unknown request response = %q", output.String()) }
}

func TestUnreviewableFileChangeIsDeclined(t *testing.T) {
	message := wireMessage{ID: json.RawMessage(`9`), Method: "item/fileChange/requestApproval", Params: json.RawMessage(`{"reason":"Change a file"}`)}
	var output bytes.Buffer
	if err := respondToServerRequest(context.Background(), &output, message, func(context.Context, ApprovalRequest) bool {
		t.Fatal("approval was requested without a file path")
		return true
	}); err != nil { t.Fatal(err) }
	if !strings.Contains(output.String(), `"decision":"decline"`) { t.Fatalf("unreviewable response = %q", output.String()) }
}
