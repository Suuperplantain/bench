package main

import "testing"

func TestRequireLoopback(t *testing.T) {
	tests := []struct {
		address string
		wantErr bool
	}{
		{address: "127.0.0.1:7341"},
		{address: "[::1]:7341"},
		{address: "localhost:7341"},
		{address: "0.0.0.0:7341", wantErr: true},
		{address: ":7341", wantErr: true},
		{address: "not-an-address", wantErr: true},
	}
	for _, test := range tests {
		t.Run(test.address, func(t *testing.T) {
			err := requireLoopback(test.address)
			if (err != nil) != test.wantErr {
				t.Fatalf("requireLoopback(%q) error = %v, wantErr %t", test.address, err, test.wantErr)
			}
		})
	}
}
