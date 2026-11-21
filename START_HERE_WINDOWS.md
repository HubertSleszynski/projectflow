# ProjectFlow 1.1 — aktualizacja i uruchomienie w Windows / Git Bash

## 1. Zachowaj dane i konfigurację

Przed zmianami zatrzymaj terminale `dev:api` i `dev:web` (`Ctrl+C`). Zrób kopię dotychczasowego folderu projektu. **Nie usuwaj wolumenu PostgreSQL** i nie używaj `docker compose down -v`.

Rozpakuj archiwum **do tego samego katalogu głównego** ProjectFlow, w którym masz obecnie `package.json`, `client/`, `server/` i `docker-compose.yml`. Nadpisz pliki źródłowe. Dzięki temu zachowasz lokalne `server/.env`, a Docker Compose użyje dotychczasowego projektu i wolumenu bazy. Archiwum celowo nie zawiera `server/.env`, `node_modules` ani `.next`.

Jeśli wolisz rozpakować paczkę do nowego folderu, przekopiuj do niego **wyłącznie swoją lokalną konfigurację** `server/.env`. Uwaga: nowa nazwa folderu może zmienić nazwę projektu Docker Compose i sprawiać wrażenie pustej bazy. Najprościej aktualizować dotychczasowy folder.

Nie wykonuj `prisma migrate reset` ani nie usuwaj danych Docker Compose.

## 2. Jednorazowa aktualizacja do v1.1

Uruchom **Docker Desktop**, wejdź w Git Bash do katalogu projektu i wpisz:

```bash
docker compose up -d --wait postgres
npm.cmd install
npm.cmd run db:generate
npm.cmd run db:deploy
npm.cmd run verify:all
npm.cmd run build
```

**Nowość:** `db:deploy` wykonuje addytywną migrację dwóch pól kont demonstracyjnych. Nie usuwa istniejących kont ani projektów. Jeśli migracja zwróci błąd, nie zgadzaj się na reset — prześlij log.

Po udanej aktualizacji otwórz dwa osobne terminale Git Bash:

```bash
# Terminal 1
npm.cmd run dev:api
```

```bash
# Terminal 2
npm.cmd run dev:web
```

Wejdź na http://localhost:3000. Sprawdź logowanie na dotychczasowe konto. Wyloguj się, kliknij **Explore demo workspace** i sprawdź demo Kanban. Demo nie wymaga rejestracji i jest odseparowane od Twoich danych.

## 3. Codzienne uruchamianie

```bash
docker compose up -d --wait postgres
```

Potem `npm.cmd run dev:api` w pierwszym terminalu i `npm.cmd run dev:web` w drugim. Nie trzeba codziennie instalować pakietów ani ponownie uruchamiać migracji.

## 4. Porządek po aktualizacji

Z poprzednich wersji można usunąć (jeśli nadal są w Twoim folderze):

```text
client/components/database-panel.tsx
client/components/status-dashboard.tsx
server/src/lib/demo-access.ts
PATCH_AUDIT_2_GIT_BASH.md
PATCH_SECURITY_WINDOWS.md
POPRAWKA-README.md
FILE_MANIFEST.sha256
check-auth.bat, check-database.bat, check-health.bat
init-database.bat, start-dev.bat
server/src/routes/database.ts
server/prisma/seed.ts
```

Nowe archiwum już tych plików nie zawiera. Nie usuwaj `server/.env`, `server/prisma/migrations/`, `.git/` ani własnych plików pracy.

## 5. Bezpieczne repozytorium

Przed wypchnięciem na GitHub sprawdź `git status --short` i `git check-ignore server/.env`. Nigdy nie commituj `.env`, `node_modules`, `.next`, `server/dist` ani `.env.production`.

**Znany problem:** `npm audit` nadal może zgłaszać ostrzeżenia z pośrednich zależności Prisma 6. Nie używaj `npm audit fix --force`; szczegóły w `SECURITY.md`. Przed publicznym wdrożeniem wymagany jest osobny przegląd bezpieczeństwa.
