# Claude Code локально через VDS — пошаговая инструкция

Эта инструкция описывает, как пользоваться **Claude Code на своём компьютере**, отправляя запросы к API Anthropic через ваш VDS и VPN (например, для обхода блокировок).

---

## Схема работы

```
Ваш компьютер (Claude Code)
    → SSH-туннель (локальный порт 3128)
    → VDS: Squid-прокси на 127.0.0.1:3128
    → VDS: исходящий трафик через VPN (UK)
    → api.anthropic.com
```

API-ключ Anthropic хранится только у вас; на VDS нужны только VPN и прокси.

---

## Часть 1. Подготовка VDS (один раз)

### 1.1. VPN на VDS

На сервере должен быть поднят VPN с выходом в нужную страну (например UK).

- **Если VPN уже настроен** — проверьте:
  ```bash
  ssh USER@VDS_HOST
  curl -s ifconfig.co/country
  curl -sI https://api.anthropic.com
  ```
  Должны быть нужная страна и ответ от Anthropic (401/403 без ключа — нормально).

- **Если VPN ещё нет** — см. раздел «AmneziaVPN (UK) на VDS» в [VDS_CLAUDE_PROXY_SETUP.md](VDS_CLAUDE_PROXY_SETUP.md).

### 1.2. Прокси Squid на VDS

На том же VDS нужно установить и настроить Squid как CONNECT-прокси только на localhost.

1. Подключитесь к VDS и перейдите в каталог проекта (или скопируйте туда скрипт):
   ```bash
   ssh USER@VDS_HOST
   cd /opt/telegram-calendar-bot
   ```
2. Запустите скрипт установки (от root или через sudo):
   ```bash
   sudo bash scripts/vds-setup-claude-proxy.sh
   ```
3. Проверка на VDS:
   ```bash
   curl -x http://127.0.0.1:3128 -sI https://api.anthropic.com
   ```
   Ожидается ответ от Anthropic. Порт 3128 в интернет не открывайте.

---

## Часть 2. Настройка на вашем компьютере

### 2.1. Файл .env.local

В корне проекта создайте или отредактируйте `.env.local` (он в `.gitignore`, в репозиторий не попадёт). Укажите хост и пользователя VDS — те же, что для деплоя:

```bash
SSH_HOST=IP_или_хост_VDS
SSH_USER=root
```

Замените на свои значения. SSH-ключ должен быть настроен так, чтобы подключение без пароля работало (или вводите пароль при поднятии туннеля).

### 2.2. Установка Claude Code

Если Claude Code ещё не установлен: [документация Anthropic](https://docs.anthropic.com/en/docs/claude-code/setup). В терминале должна быть команда `claude`.

---

## Часть 3. Запуск Claude Code через VDS

### Вариант A: Одна команда (рекомендуется)

В каталоге проекта выполните:

```bash
cd /path/to/96.openclaw-projects
./scripts/claude-vds-local.sh
```

Скрипт сам поднимет SSH-туннель (если он ещё не поднят), выставит прокси и запустит `claude`. Все запросы к API пойдут через VDS и VPN.

### Вариант B: Туннель отдельно, Claude — вручную

1. Поднять туннель:
   ```bash
   ./scripts/claude-vds-tunnel.sh
   ```
2. В другом терминале:
   ```bash
   export HTTPS_PROXY=http://127.0.0.1:3128
   claude
   ```

### Вариант C: Ручной SSH-туннель

```bash
ssh -f -N -L 3128:127.0.0.1:3128 USER@VDS_HOST
export HTTP_PROXY=http://127.0.0.1:3128
export HTTPS_PROXY=http://127.0.0.1:3128
claude
```

### Вариант D: Туннель при входе в систему (macOS)

Чтобы туннель поднимался при логине и не нужно было каждый раз запускать скрипт:

1. Создать plist из шаблона (подставьте свой путь к проекту):
   ```bash
   sed "s|PROJECT_ROOT|$(cd /path/to/96.openclaw-projects && pwd)|g" config/claude-vds-tunnel.plist.template > ~/Library/LaunchAgents/com.claude-vds.tunnel.plist
   ```
2. Загрузить агенту:
   ```bash
   launchctl load ~/Library/LaunchAgents/com.claude-vds.tunnel.plist
   ```
3. Логи: `/tmp/claude-vds-tunnel.log`, `/tmp/claude-vds-tunnel.err`. Остановка: `launchctl unload ~/Library/LaunchAgents/com.claude-vds.tunnel.plist`.

После этого порт 3128 будет доступен после входа. Можно задать прокси в настройках Claude (см. ниже) и запускать `claude` как обычно.

---

## Постоянная настройка прокси для Claude (опционально)

Если туннель вы поднимаете отдельно (скриптом или LaunchAgent), в `~/.claude/settings.json` можно указать:

```json
{
  "env": {
    "HTTP_PROXY": "http://127.0.0.1:3128",
    "HTTPS_PROXY": "http://127.0.0.1:3128",
    "NO_PROXY": "localhost,127.0.0.1"
  }
}
```

Имеет смысл только когда туннель уже поднят, иначе запросы будут падать.

---

## Проверка

**На VDS (при поднятом VPN):**
```bash
curl -s ifconfig.co/country
curl -x http://127.0.0.1:3128 -sI https://api.anthropic.com
```

**Локально (после поднятия туннеля):**
```bash
export HTTPS_PROXY=http://127.0.0.1:3128
curl -sI https://api.anthropic.com
```
Должен ответить сервер Anthropic. Затем запустите Claude Code с теми же переменными.

---

## Краткий чек-лист

| Где   | Действие |
|-------|----------|
| **VDS** | 1) VPN поднят, проверен доступ к api.anthropic.com. 2) Squid установлен (`vds-setup-claude-proxy.sh`), проверка через `curl -x http://127.0.0.1:3128 -sI https://api.anthropic.com`. |
| **Компьютер** | 1) В `.env.local`: `SSH_HOST`, `SSH_USER`. 2) Установлен Claude Code. 3) Запуск: `./scripts/claude-vds-local.sh` (или туннель вручную + `HTTPS_PROXY` + `claude`). |

---

## Подробности и устранение неполадок

Полная настройка VPN, ручная настройка Squid, несколько компьютеров, типичные ошибки SSH — в [VDS_CLAUDE_PROXY_SETUP.md](VDS_CLAUDE_PROXY_SETUP.md).
