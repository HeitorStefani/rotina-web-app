# 📅 Rotina App

Organizador de rotina pessoal com notificações automáticas via Telegram.

## ✨ Funcionalidades

- 🔄 **Rotinas diárias** — eventos que repetem todo dia (ex: academia 7h)
- 📅 **Semanais** — dias específicos da semana com horário
- 📌 **Compromissos únicos** — data e hora específica
- ⏰ **Tarefas com prazo** — deadline com aviso antecipado
- 🤖 **Notificações Telegram** — aviso automático X minutos antes
- ☀️ **Resumo matinal** — todo dia às 07:00 você recebe o dia completo
- 🔐 Login com usuário e senha

---

## 🚀 Setup Local (Desenvolvimento)

### 1. Instalar dependências

```bash
# Backend
cd backend && npm install

# Frontend
cd ../frontend && npm install
```

### 2. Criar seu Bot Telegram

1. Abra o Telegram → pesquise `@BotFather`
2. Envie `/newbot` e siga as instruções
3. Copie o **token** gerado

### 3. Configurar variáveis de ambiente

```bash
cd backend
cp .env.example .env
```

Edite o `.env`:
```env
TELEGRAM_BOT_TOKEN=seu_token_aqui
JWT_SECRET=uma-chave-secreta-aleatoria-aqui
PORT=3001
FRONTEND_URL=http://localhost:3000
```

### 4. Rodar o projeto

**Terminal 1 — Backend:**
```bash
cd backend && node server.js
```

**Terminal 2 — Frontend:**
```bash
cd frontend && npm start
```

Acesse: **http://localhost:3000**

---

## ☁️ Deploy Gratuito na Nuvem (Railway)

### Passo a passo Railway

1. **Criar conta** em [railway.app](https://railway.app) (grátis)

2. **Fazer build do frontend:**
   ```bash
   cd frontend && npm run build
   ```
   Isso cria a pasta `frontend/build/`

3. **Deploy pelo GitHub:**
   - Suba o projeto para um repositório GitHub
   - No Railway: **New Project → Deploy from GitHub repo**
   - Selecione o repositório

4. **Configurar variáveis no Railway:**
   - Vá em **Variables** no dashboard do Railway
   - Adicione:
     ```
     TELEGRAM_BOT_TOKEN = seu_token_aqui
     JWT_SECRET = chave-secreta-aleatoria
     PORT = 3001
     ```

5. **Configurar o start command:**
   - Em **Settings → Deploy → Start Command:**
   ```
   npm run start
   ```

6. **Configurar Webhook do Telegram** (para o comando /id funcionar):
   ```
   https://api.telegram.org/bot{SEU_TOKEN}/setWebhook?url=https://sua-app.railway.app/api/telegram/webhook
   ```
   Acesse essa URL no navegador uma vez.

### Alternativa: Render.com

1. [render.com](https://render.com) → New Web Service
2. Conecte o GitHub repo
3. **Build Command:** `cd frontend && npm install && npm run build && cd ../backend && npm install`
4. **Start Command:** `cd backend && node server.js`
5. Adicione as variáveis de ambiente

---

## 📱 Configurar notificações

1. Acesse o app → **Configurações**
2. Siga as instruções para encontrar seu bot
3. Envie `/id` no bot para obter seu Chat ID
4. Cole o Chat ID nas configurações e clique **Testar**
5. Salve as configurações

---

## 🗂️ Estrutura do projeto

```
rotina-app/
├── backend/
│   ├── server.js          # Entry point
│   ├── db.js              # SQLite schema e conexão
│   ├── scheduler.js       # Motor de notificações (cron)
│   ├── middleware/
│   │   └── auth.js        # JWT middleware
│   └── routes/
│       ├── auth.js        # Login/registro/perfil
│       ├── events.js      # CRUD de eventos
│       └── telegram.js    # Bot, test, webhook
├── frontend/
│   └── src/
│       ├── App.js
│       ├── styles.css
│       └── components/
│           ├── Login.js
│           ├── Dashboard.js
│           ├── TodayView.js
│           ├── EventsView.js
│           └── SettingsView.js
└── README.md
```

---

## 🔧 Como funciona o agendador

O scheduler roda **a cada minuto** e:
1. Busca todos os usuários com Telegram configurado
2. Para cada evento ativo, verifica se deve disparar hoje
3. Calcula o horário de notificação (horário do evento - minutos de antecedência)
4. Se bater com o minuto atual → envia mensagem no Telegram
5. Salva log para evitar duplicatas

---

## 📦 Tecnologias

| Camada | Tecnologia |
|--------|-----------|
| Frontend | React 18 |
| Backend | Node.js + Express |
| Banco | SQLite (better-sqlite3) |
| Agendador | node-cron |
| Notificações | Telegram Bot API |
| Auth | JWT + bcrypt |
| Hosting | Railway / Render (free) |
