# Настройка VDS для пайплайна Claude Code + VPN + прокси

Пайплайн: локально WebStorm и Claude Code (консоль), запросы к Claude API идут через VDS с AmneziaVPN (UK), чтобы обойти блокировки при работе из РФ.

## Схема трафика

```
Локально (WebStorm + Claude Code)
    → HTTPS_PROXY=http://127.0.0.1:3128 (через SSH-туннель)
    → VDS: Squid на 127.0.0.1:3128
    → VDS: исходящий трафик через AmneziaVPN (UK)
    → api.anthropic.com
```

Прокси на VDS слушает **только** localhost; доступ с вашей машины — только через SSH port forward. Порт прокси **не** открывать в firewall в интернет.

---

## 1. AmneziaVPN (UK) на VDS

### Если VPN уже установлен

1. Подключитесь к VDS по SSH и поднимите VPN (если не поднимается автоматически).
2. Проверьте выход в UK:
   ```bash
   curl -s ifconfig.co
   curl -s ifconfig.co/country
   ```
   Должны быть IP в UK и страна `GB` (или аналог).
3. Проверьте доступ к Anthropic:
   ```bash
   curl -sI https://api.anthropic.com
   ```
   Ожидается ответ от Anthropic (401/403 без ключа — нормально).

### Если VPN ещё не установлен

**Amnezia Premium (подписка):** в ссылке `vpn://...` нет готового WireGuard-конфига — он подгружается в приложении по API. Для headless-сервера (VDS) нужен файл в формате **.conf** (WireGuard):

1. Зайдите в личный кабинет Amnezia Premium: [cp.amnezia.org](https://cp.amnezia.org) (или [зеркало](https://storage.googleapis.com/amnezia/cp?m-path=/)).
2. Скачайте подключение в формате **WireGuard** (экспорт как .conf).
3. Загрузите этот файл на VDS (например в `/etc/amnezia/amneziawg/amnezia.conf`) и поднимите туннель (см. ниже «Установка AmneziaWG на VDS»).

**Self-hosted / .vpn с контейнерами:** если у вас есть файл .vpn со структурой `containers` и `awg`, можно сконвертировать в .conf скриптом `scripts/amnezia-vpn-to-wg.py` (см. комментарии в скрипте).

После появления .conf на VDS настройте маршрутизацию так, чтобы исходящий трафик шёл через VPN (см. ниже).

#### Установка AmneziaWG на VDS (когда есть .conf)

На сервере (Debian/Ubuntu):

```bash
sudo add-apt-repository -y ppa:amnezia/ppa
sudo apt-get update && sudo apt-get install -y amneziawg
sudo mkdir -p /etc/amnezia/amneziawg
# положите ваш .conf как /etc/amnezia/amneziawg/amnezia.conf
sudo chmod 600 /etc/amnezia/amneziawg/amnezia.conf
sudo awg-quick up amnezia
```

Имя конфига — имя файла без `.conf` (например `amnezia.conf` → `awg-quick up amnezia`). Чтобы туннель поднимался при загрузке: `sudo systemctl enable awg-quick@amnezia.service`. Чтобы весь трафик шёл через VPN, в .conf обычно указывают `AllowedIPs = 0.0.0.0/0` (или только нужные маршруты).

---

## 2. Прокси на VDS (вариант A — рекомендуется)

Используется HTTP CONNECT-прокси (Squid), только на localhost. Локально Claude Code настраивается через `HTTPS_PROXY`.

### Установка и настройка одним скриптом

На VDS выполните (от root или через sudo):

```bash
# Скопируйте скрипт на сервер и запустите, например:
cd /opt/telegram-calendar-bot
bash scripts/vds-setup-claude-proxy.sh
```

Скрипт устанавливает Squid (если ещё не установлен), настраивает его на прослушивание `127.0.0.1:3128`, разрешает доступ только с localhost и включает автозапуск. Подробности — в [scripts/vds-setup-claude-proxy.sh](../scripts/vds-setup-claude-proxy.sh).

### Ручная настройка Squid

Если предпочитаете ручную установку (Debian/Ubuntu):

```bash
sudo apt-get update && sudo apt-get install -y squid
sudo cp /etc/squid/squid.conf /etc/squid/squid.conf.bak
```

В `/etc/squid/squid.conf` задайте (или замените `http_port` и ACL):

- Слушать только localhost: `http_port 127.0.0.1:3128`
- Разрешить доступ только с localhost и CONNECT на 443 (и при необходимости 8443)

Пример минимального фрагмента:

```
acl localhost src 127.0.0.1
acl SSL_ports port 443
acl SSL_ports port 8443
acl CONNECT method CONNECT
http_access allow localhost CONNECT SSL_ports
http_access deny all
http_port 127.0.0.1:3128
```

Перезапуск:

```bash
sudo systemctl restart squid
sudo systemctl enable squid
```

### Порядок запуска (VPN → прокси)

Прокси использует исходящий трафик системы. Если весь исходящий трафик VDS идёт через VPN, достаточно поднимать VPN до начала работы (или до перезагрузки). Если VPN поднимается вручную — сначала включите VPN, затем пользуйтесь прокси.

**Опционально: запуск прокси после VPN (systemd).** Если у вас есть systemd-юнит для AmneziaVPN (например `amneziavpn.service`), можно задать порядок запуска:

```bash
sudo mkdir -p /etc/systemd/system/squid.service.d
echo -e '[Unit]\nAfter=amneziavpn.service' | sudo tee /etc/systemd/system/squid.service.d/after-vpn.conf
sudo systemctl daemon-reload
```

Имя сервиса VPN замените на актуальное. После этого Squid будет стартовать после VPN.

### Безопасность

- Не открывайте порт 3128 (и любой порт прокси) в firewall в интернет.
- Оставьте прокси только на `127.0.0.1`. Доступ с вашего компьютера — только через SSH-туннель (см. ниже).

---

## 3. Локальная настройка (Claude Code)

### SSH-туннель к прокси на VDS

Перед запуском Claude Code поднимите туннель (подставьте свой хост и пользователя):

```bash
ssh -L 3128:127.0.0.1:3128 USER@VDS_HOST -N
```

Или в фоне:

```bash
ssh -f -L 3128:127.0.0.1:3128 USER@VDS_HOST -N
```

Тогда на вашей машине порт `3128` будет вести на прокси на VDS.

### Переменные окружения для Claude Code

В той же сессии (или в профиле оболочки, если туннель всегда поднят):

```bash
export HTTP_PROXY=http://127.0.0.1:3128
export HTTPS_PROXY=http://127.0.0.1:3128
export NO_PROXY=localhost,127.0.0.1
```

Затем запускайте Claude Code (консоль). Он будет отправлять запросы к API через туннель → VDS → VPN → Anthropic.

### Постоянная настройка (опционально)

В `~/.claude/settings.json` можно задать:

```json
{
  "env": {
    "HTTP_PROXY": "http://127.0.0.1:3128",
    "HTTPS_PROXY": "http://127.0.0.1:3128",
    "NO_PROXY": "localhost,127.0.0.1"
  }
}
```

Имеет смысл использовать это только когда туннель уже поднят (иначе запросы будут падать). API-ключ Anthropic задаётся как обычно (переменная или настройки Claude Code), на VDS ключ для варианта A не нужен.

---

## 4. Проверка

### На VDS (при поднятом VPN)

```bash
curl -s ifconfig.co/country
# Ожидается GB (или ваш UK-код)

curl -sI https://api.anthropic.com
# Ответ от Anthropic (401/403 без ключа — нормально)
```

Через прокси на самом VDS:

```bash
curl -x http://127.0.0.1:3128 -sI https://api.anthropic.com
# Должен пройти через прокси; ответ от Anthropic
```

### Локально

1. Запустите SSH-туннель: `ssh -L 3128:127.0.0.1:3128 USER@VDS_HOST -N`.
2. В другом терминале:
   ```bash
   export HTTPS_PROXY=http://127.0.0.1:3128
   curl -sI https://api.anthropic.com
   ```
   Должен ответить сервер Anthropic.
3. Запустите Claude Code с теми же переменными и выполните запрос к API — он должен проходить через VDS и VPN.

---

## 5. Какие данные нужны от вас (чек-лист)

Чтобы довести настройку под вашу среду, убедитесь, что у вас есть:

| Категория | Что нужно |
|-----------|-----------|
| **SSH** | Хост VDS (`SSH_HOST`), пользователь (`SSH_USER`), ключ или пароль — те же, что для деплоя бота, или отдельные для туннеля. |
| **VDS** | ОС и версия (например Ubuntu 22.04), доступ root/sudo для установки Squid. |
| **AmneziaVPN** | Уже установлен на VDS или план установки; конфиг/профиль для UK-сервера (без передачи секретов в репозиторий). |
| **Claude API** | Ключ Anthropic (Claude Max 20x) — хранится только локально, для варианта A на VDS не нужен. |
| **.env.local** | Не коммитить. Имеет смысл хранить только данные для SSH (хост, пользователь) и при необходимости скрипт/алиас для туннеля и `HTTPS_PROXY`. |

---

## Вариант B: Reverse proxy к Anthropic API

Если вместо CONNECT-прокси нужен свой endpoint (например [ClaudeProxy](https://github.com/missuo/claudeproxy)):

- Разверните сервис на VDS, который принимает запросы в формате Anthropic API и проксирует их на `https://api.anthropic.com` (трафик с VDS — через VPN).
- Слушайте только на `127.0.0.1` или за nginx с TLS и авторизацией; порт не открывать в интернет.
- Локально: SSH-туннель до этого сервиса и в Claude Code: `ANTHROPIC_BASE_URL=https://127.0.0.1` (или ваш URL), API-ключ — по документации выбранного решения.

Для сценария «локальный Claude Code + минимум открытых портов» обычно достаточно варианта A (Squid + SSH-туннель), описанного выше.
