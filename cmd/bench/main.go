package main

import (
	"context"
	"errors"
	"flag"
	"fmt"
	"log"
	"net"
	"net/http"
	"os"
	"os/signal"
	"path/filepath"
	"strings"
	"syscall"
	"time"

	"github.com/Suuperplantain/bench/internal/api"
	"github.com/Suuperplantain/bench/internal/discovery"
	"github.com/Suuperplantain/bench/internal/store"
)

type stringList []string

func (values *stringList) String() string { return fmt.Sprint([]string(*values)) }

func (values *stringList) Set(value string) error {
	if value == "" {
		return errors.New("root path cannot be empty")
	}
	*values = append(*values, value)
	return nil
}

func main() {
	var roots stringList
	flag.Var(&roots, "root", "folder to scan for Git repositories; repeat to add more")
	listenAddress := flag.String("listen", "127.0.0.1:7341", "local HTTP listen address")
	databasePath := flag.String("db", filepath.Join(".bench", "bench.db"), "SQLite database path")
	flag.Parse()

	if len(roots) == 0 {
		roots = append(roots, ".")
	}
	absRoots := make([]string, 0, len(roots))
	for _, root := range roots {
		absolute, err := filepath.Abs(root)
		if err != nil {
			log.Fatalf("resolve scan root %q: %v", root, err)
		}
		absRoots = append(absRoots, absolute)
	}
	if err := requireLoopback(*listenAddress); err != nil {
		log.Fatal(err)
	}

	if err := os.MkdirAll(filepath.Dir(*databasePath), 0o700); err != nil {
		log.Fatalf("create database directory: %v", err)
	}

	database, err := store.Open(*databasePath)
	if err != nil {
		log.Fatalf("open database: %v", err)
	}
	defer database.Close()

	handler := api.NewHandler(discovery.New(absRoots), database)
	server := &http.Server{
		Addr:              *listenAddress,
		Handler:           handler,
		ReadHeaderTimeout: 5 * time.Second,
		ReadTimeout:       10 * time.Second,
		WriteTimeout:      15 * time.Second,
		IdleTimeout:       60 * time.Second,
	}

	listener, err := net.Listen("tcp", *listenAddress)
	if err != nil {
		log.Fatalf("listen on %s: %v", *listenAddress, err)
	}
	log.Printf("Bench API listening at http://%s", listener.Addr())

	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	serverErrors := make(chan error, 1)
	go func() { serverErrors <- server.Serve(listener) }()

	select {
	case <-ctx.Done():
		shutdownCtx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		if err := server.Shutdown(shutdownCtx); err != nil {
			log.Printf("server shutdown: %v", err)
		}
	case err := <-serverErrors:
		if !errors.Is(err, http.ErrServerClosed) {
			log.Fatalf("serve: %v", err)
		}
	}
}

func requireLoopback(address string) error {
	host, _, err := net.SplitHostPort(address)
	if err != nil {
		return fmt.Errorf("invalid listen address %q: %w", address, err)
	}
	if strings.EqualFold(host, "localhost") {
		return nil
	}
	ip := net.ParseIP(host)
	if ip == nil || !ip.IsLoopback() {
		return fmt.Errorf("Bench only listens on this computer; use 127.0.0.1 or localhost")
	}
	return nil
}
