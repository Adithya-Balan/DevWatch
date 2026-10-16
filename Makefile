# DevWatch — Development Makefile
UUID     := devwatch@github.io
INSTALL  := $(HOME)/.local/share/gnome-shell/extensions/$(UUID)
SRC      := $(shell pwd)

# Re-link every source file in the project to the GNOME extensions directory.
# Run `make link` once after adding any new .js / .css / .json file.
.PHONY: link
link: compile-schemas
	@mkdir -p $(INSTALL)
	@for f in $(SRC)/*.js $(SRC)/*.css $(SRC)/*.json; do \
	  [ -f "$$f" ] || continue; \
	  ln -sf "$$f" "$(INSTALL)/$$(basename $$f)"; \
	  echo "  Linked: $$(basename $$f)"; \
	done
	@for d in ui core utils schemas; do \
	  [ -d "$(SRC)/$$d" ] || continue; \
	  mkdir -p "$(INSTALL)/$$d"; \
	  for f in "$(SRC)/$$d"/*; do \
	    [ -f "$$f" ] || continue; \
	    ln -sf "$$f" "$(INSTALL)/$$d/$$(basename $$f)"; \
	    echo "  Linked: $$d/$$(basename $$f)"; \
	  done; \
	done

# Compile GSettings schemas (required whenever the .gschema.xml changes)
.PHONY: compile-schemas
compile-schemas:
	@glib-compile-schemas $(SRC)/schemas/
	@echo "  Schemas compiled."

# Pack the extension into a distributable zip (compile schemas first)
# Output: devwatch@github.io.shell-extension.zip — ready for EGO upload.
.PHONY: pack
pack: compile-schemas
	gnome-extensions pack \
	  --force \
	  --extra-source=ui \
	  --extra-source=core \
	  --extra-source=utils \
	  --extra-source=schemas \
	  .
	@echo "  Built: $(UUID).shell-extension.zip"

# Enable the extension (works only after a login where the shell picks it up)
.PHONY: enable
enable:
	gnome-extensions enable $(UUID)

# Disable the extension
.PHONY: disable
disable:
	gnome-extensions disable $(UUID)

# Tail the GNOME Shell log — your console.log() appears here
.PHONY: log
log:
	journalctl -f -o cat /usr/bin/gnome-shell

# Show extension status
.PHONY: status
status:
	gnome-extensions info $(UUID)

# Launch a nested Wayland GNOME Shell for safe testing.
# Must be run from a terminal INSIDE your graphical GNOME session
# (needs $WAYLAND_DISPLAY set — use gnome-terminal, not VS Code terminal).
.PHONY: nested
nested:
	MUTTER_DEBUG_DUMMY_MODE_SPECS=1920x1080 \
	dbus-run-session -- gnome-shell --devkit --wayland

# ── i18n helpers ──────────────────────────────────────────────────────────────

DOMAIN  := devwatch@github.io
POT     := po/$(DOMAIN).pot

# Extract translatable strings from all source files listed in po/POTFILES.
# Run after adding new _('...') calls to update the translation template.
.PHONY: pot
pot:
	@xgettext \
	  --from-code=UTF-8 \
	  --language=JavaScript \
	  --keyword=_ \
	  --keyword=ngettext:1,2 \
	  --keyword=pgettext:1c,2 \
	  --output=$(POT) \
	  $(shell cat po/POTFILES | grep -v '^#' | grep -v '^$$')
	@echo "  Updated: $(POT)"

# Merge each existing .po file with the latest .pot template.
# Run after `make pot` to propagate new strings to translators.
.PHONY: update-po
update-po: pot
	@for lang in $$(cat po/LINGUAS | grep -v '^#' | grep -v '^$$'); do \
	  pofile="po/$$lang.po"; \
	  if [ -f "$$pofile" ]; then \
	    msgmerge --update "$$pofile" $(POT); \
	    echo "  Updated: $$pofile"; \
	  else \
	    msginit --input=$(POT) --locale=$$lang --output="$$pofile" --no-translator; \
	    echo "  Created: $$pofile"; \
	  fi; \
	done

# Compile all .po files listed in po/LINGUAS into binary .mo files,
# installed under locale/ so that initTranslations() can find them.
.PHONY: compile-mo
compile-mo:
	@for lang in $$(cat po/LINGUAS | grep -v '^#' | grep -v '^$$'); do \
	  pofile="po/$$lang.po"; \
	  modir="locale/$$lang/LC_MESSAGES"; \
	  mofile="$$modir/$(DOMAIN).mo"; \
	  mkdir -p "$$modir"; \
	  msgfmt "$$pofile" -o "$$mofile"; \
	  echo "  Compiled: $$mofile"; \
	done
