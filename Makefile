BIN      := lattice
PREFIX   := $(HOME)/.local/bin
PLIST_ID := dev.yeksax.lattice
PLIST    := $(HOME)/Library/LaunchAgents/$(PLIST_ID).plist

.PHONY: build dev dev-dash install uninstall clean web web-build web-deploy cloud-dev cloud-deploy

build:
	CGO_ENABLED=0 go build -trimpath -ldflags "-s -w" -o $(BIN) ./cmd/lattice

dev: build
	./$(BIN) serve

# Live-reload dev loop for the dashboard. LATTICE_DEV serves cmd/lattice/dashboard
# from disk, so editing HTML/CSS/JS reloads the browser with no rebuild; wgo
# rebuilds and restarts the daemon on any .go change (the browser reconnects and
# reloads). Runs on :4601 so it never fights the installed daemon on :4600.
dev-dash:
	@echo "dev dashboard: http://127.0.0.1:4601 (live reload; Ctrl-C to stop)"
	LATTICE_DEV=1 LATTICE_ADDR=127.0.0.1:4601 LATTICE_ALIAS_ADDR=off \
		go run github.com/bokwoon95/wgo@latest run -file .go ./cmd/lattice serve

# Public Astro site.
web:
	pnpm install
	pnpm --filter lattice-web dev

web-build:
	pnpm install
	pnpm --filter lattice-web build

web-deploy:
	pnpm --filter lattice-web run deploy

# Hosted share backend (Cloudflare Worker). See cloud/README.md for D1/R2 setup.
cloud-dev:
	pnpm install
	pnpm --filter lattice-share dev

cloud-deploy:
	pnpm --filter lattice-share run deploy

install: build
	mkdir -p $(PREFIX) $(HOME)/.summaries/.lattice/meta $(HOME)/Library/LaunchAgents
	cp $(BIN) $(PREFIX)/$(BIN)
	$(PREFIX)/$(BIN) skills install
	sed "s|__HOME__|$(HOME)|g" launchd/$(PLIST_ID).plist > $(PLIST)
	launchctl bootout gui/$$(id -u)/$(PLIST_ID) 2>/dev/null || true
	launchctl bootstrap gui/$$(id -u) $(PLIST)
	@echo "lattice installed: http://127.0.0.1:4600"

uninstall:
	launchctl bootout gui/$$(id -u)/$(PLIST_ID) 2>/dev/null || true
	rm -f $(PLIST) $(PREFIX)/$(BIN)

clean:
	rm -f $(BIN)
	rm -rf web/dist web/.astro
