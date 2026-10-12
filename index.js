const { Client, GatewayIntentBits, Partials, EmbedBuilder, PermissionFlagsBits, SlashCommandBuilder, REST, Routes, MessageFlags } = require('discord.js');
const express = require('express');
const session = require('express-session');
const fs = require('fs');
const path = require('path');

const TOKEN = process.env.TOKEN;
const PORT = process.env.PORT || 8080;
const DASH_PASSWORD = process.env.DASH_PASSWORD || 'admin123';
const SESSION_SECRET = process.env.SESSION_SECRET || 'bot-secret-change-me';

if (!TOKEN) {
  console.error('Missing TOKEN');
  process.exit(1);
}

const dataPath = path.join(__dirname, 'data.json');
let data = { bannedWords: [], whitelist: [], logChannelId: '' };
try {
  if (fs.existsSync(dataPath)) data = JSON.parse(fs.readFileSync(dataPath, 'utf8'));
} catch (e) {}

function saveData() {
  try { fs.writeFileSync(dataPath, JSON.stringify(data, null, 2)); } catch (e) {}
}

// ===== BOT =====
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildModeration
  ],
  partials: [Partials.Message, Partials.Channel, Partials.GuildMember]
});

const commands = [
  new SlashCommandBuilder().setName('addword').setDescription('Add banned word')
    .addStringOption(o => o.setName('word').setDescription('word').setRequired(true))
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
  new SlashCommandBuilder().setName('removeword').setDescription('Remove banned word')
    .addStringOption(o => o.setName('word').setDescription('word').setRequired(true))
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
  new SlashCommandBuilder().setName('listwords').setDescription('List banned words')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
  new SlashCommandBuilder().setName('setlog').setDescription('Set log channel')
    .addChannelOption(o => o.setName('channel').setDescription('channel').setRequired(true))
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
  new SlashCommandBuilder().setName('whitelist').setDescription('Add to whitelist')
    .addUserOption(o => o.setName('user').setDescription('user').setRequired(true))
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
  new SlashCommandBuilder().setName('unwhitelist').setDescription('Remove from whitelist')
    .addUserOption(o => o.setName('user').setDescription('user').setRequired(true))
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
];

client.once('clientReady', async () => {
  console.log('Bot online:', client.user.tag);
  client.user.setActivity('Server Protection', { type: 3 });
  try {
    const rest = new REST({ version: '10' }).setToken(TOKEN);
    await rest.put(Routes.applicationCommands(client.user.id), { body: commands });
    console.log('Commands registered');
  } catch (e) {
    console.error('Command error:', e.message);
  }
});

client.on('messageCreate', async (message) => {
  try {
    if (message.author.bot || !message.guild) return;
    if (data.whitelist.includes(message.author.id)) return;
    if (message.member?.permissions?.has(PermissionFlagsBits.Administrator)) return;

    const content = message.content.toLowerCase();
    const found = data.bannedWords.find(w => content.includes(String(w).toLowerCase()));
    if (found) {
      await message.delete().catch(() => {});
      try { await message.member.timeout(5 * 60 * 1000, 'Banned word'); } catch {}
      if (data.logChannelId) {
        const ch = message.guild.channels.cache.get(data.logChannelId);
        if (ch) {
          const embed = new EmbedBuilder().setColor(0xFF0000).setTitle('Message Deleted')
            .setDescription(`User: ${message.author}\nWord: ||${found}||`).setTimestamp();
          ch.send({ embeds: [embed] }).catch(() => {});
        }
      }
      return;
    }

    const urls = message.content.match(/https?:\/\/[^\s]+/gi);
    if (urls) {
      const bad = [/discord\.gift/i, /free.?nitro/i, /steamcommunity\.ru/i, /disc0rd/i, /bit\.ly/i];
      if (urls.some(u => bad.some(p => p.test(u)))) {
        await message.delete().catch(() => {});
        try { await message.member.timeout(10 * 60 * 1000, 'Bad link'); } catch {}
      }
    }
  } catch (e) {}
});

const tracker = new Map();
client.on('channelDelete', async (channel) => {
  try {
    if (!channel.guild) return;
    const audit = await channel.guild.fetchAuditLogs({ type: 12, limit: 1 }).catch(() => null);
    if (!audit) return;
    const entry = audit.entries.first();
    if (!entry || entry.executor.bot || Date.now() - entry.createdTimestamp > 5000) return;
    if (data.whitelist.includes(entry.executor.id)) return;
    const key = entry.executor.id + '-ch';
    const count = (tracker.get(key) || 0) + 1;
    tracker.set(key, count);
    setTimeout(() => tracker.delete(key), 10000);
    if (count >= 3) {
      const member = await channel.guild.members.fetch(entry.executor.id).catch(() => null);
      if (member) {
        await member.roles.set([]).catch(() => {});
        await member.ban({ reason: 'Anti-Nuke' }).catch(() => {});
      }
    }
  } catch (e) {}
});

client.on('interactionCreate', async (i) => {
  if (!i.isChatInputCommand()) return;
  try {
    await i.deferReply({ flags: MessageFlags.Ephemeral });
    if (i.commandName === 'addword') {
      const word = i.options.getString('word').toLowerCase();
      if (!data.bannedWords.includes(word)) { data.bannedWords.push(word); saveData(); }
      return i.editReply('Added: **' + word + '**');
    }
    if (i.commandName === 'removeword') {
      const word = i.options.getString('word').toLowerCase();
      data.bannedWords = data.bannedWords.filter(w => w !== word); saveData();
      return i.editReply('Removed: **' + word + '**');
    }
    if (i.commandName === 'listwords') {
      return i.editReply('```' + (data.bannedWords.slice(0, 50).join(', ') || 'Empty') + '```');
    }
    if (i.commandName === 'setlog') {
      data.logChannelId = i.options.getChannel('channel').id; saveData();
      return i.editReply('Log channel set');
    }
    if (i.commandName === 'whitelist') {
      const u = i.options.getUser('user');
      if (!data.whitelist.includes(u.id)) { data.whitelist.push(u.id); saveData(); }
      return i.editReply('Whitelisted: ' + u.tag);
    }
    if (i.commandName === 'unwhitelist') {
      const u = i.options.getUser('user');
      data.whitelist = data.whitelist.filter(id => id !== u.id); saveData();
      return i.editReply('Removed: ' + u.tag);
    }
  } catch (e) {
    console.error('Interaction error:', e.message);
  }
});

client.login(TOKEN).catch(e => console.error('Login failed:', e.message));

// ===== DASHBOARD (password only, no Discord OAuth) =====
const app = express();
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'dashboard', 'views'));
app.set('trust proxy', 1);
app.use(express.urlencoded({ extended: true }));
app.use(session({
  secret: SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  proxy: true,
  cookie: { secure: true, maxAge: 86400000, sameSite: 'lax' }
}));

function requireAuth(req, res, next) {
  if (req.session && req.session.loggedIn) return next();
  return res.redirect('/login');
}

app.get('/', (req, res) => res.redirect(req.session.loggedIn ? '/dashboard' : '/login'));

app.get('/login', (req, res) => {
  const error = req.query.error ? '<p style="color:#ff6b6b">Wrong password</p>' : '';
  res.send(`<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Login</title>
  <style>
  body{font-family:Tahoma;background:#0f0f13;color:#fff;display:flex;justify-content:center;align-items:center;height:100vh;margin:0}
  .box{background:#1a1a24;padding:40px;border-radius:16px;text-align:center;width:320px}
  input{width:100%;padding:12px;margin:12px 0;border-radius:8px;border:1px solid #333;background:#0f0f18;color:#fff;box-sizing:border-box}
  button{width:100%;padding:12px;border:none;border-radius:8px;background:#5865F2;color:#fff;font-weight:bold;cursor:pointer;margin-top:8px}
  button:hover{background:#4752c4}
  </style></head><body><div class="box">
  <h1>Bot Dashboard</h1>
  ${error}
  <form method="POST" action="/login">
    <input type="password" name="password" placeholder="Password" required autofocus>
    <button type="submit">Login</button>
  </form>
  </div></body></html>`);
});

app.post('/login', (req, res) => {
  if ((req.body.password || '') === DASH_PASSWORD) {
    req.session.loggedIn = true;
    return res.redirect('/dashboard');
  }
  return res.redirect('/login?error=1');
});

app.get('/logout', (req, res) => {
  req.session.destroy(() => res.redirect('/login'));
});

app.get('/dashboard', requireAuth, (req, res) => {
  res.render('dashboard', {
    user: { username: 'Admin' },
    bannedWords: data.bannedWords || [],
    whitelist: data.whitelist || [],
    logChannelId: data.logChannelId || '',
    botTag: client.user ? client.user.tag : 'Connecting...'
  });
});

app.post('/dashboard/addword', requireAuth, (req, res) => {
  const word = (req.body.word || '').trim().toLowerCase();
  if (word && !data.bannedWords.includes(word)) { data.bannedWords.push(word); saveData(); }
  res.redirect('/dashboard');
});
app.post('/dashboard/removeword', requireAuth, (req, res) => {
  data.bannedWords = data.bannedWords.filter(w => w !== (req.body.word || '').trim().toLowerCase());
  saveData();
  res.redirect('/dashboard');
});
app.post('/dashboard/setlog', requireAuth, (req, res) => {
  data.logChannelId = (req.body.channelId || '').trim();
  saveData();
  res.redirect('/dashboard');
});
app.post('/dashboard/whitelist', requireAuth, (req, res) => {
  const id = (req.body.userId || '').trim();
  if (id && !data.whitelist.includes(id)) { data.whitelist.push(id); saveData(); }
  res.redirect('/dashboard');
});
app.post('/dashboard/unwhitelist', requireAuth, (req, res) => {
  data.whitelist = data.whitelist.filter(x => x !== (req.body.userId || '').trim());
  saveData();
  res.redirect('/dashboard');
});

app.listen(PORT, '0.0.0.0', () => {
  console.log('Dashboard running on port', PORT);
});
