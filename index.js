const { Client, GatewayIntentBits, Partials, EmbedBuilder, PermissionFlagsBits, SlashCommandBuilder, REST, Routes, MessageFlags } = require('discord.js');
const express = require('express');
const session = require('express-session');
const passport = require('passport');
const DiscordStrategy = require('passport-discord').Strategy;
const fs = require('fs');
const path = require('path');

const TOKEN = process.env.TOKEN;
const CLIENT_ID = process.env.CLIENT_ID;
const CLIENT_SECRET = process.env.CLIENT_SECRET;
const OWNER_ID = process.env.OWNER_ID;
const CALLBACK_URL = process.env.CALLBACK_URL || 'http://localhost:8080/auth/callback';
const PORT = process.env.PORT || 8080;
const SESSION_SECRET = process.env.SESSION_SECRET || 'change-this-secret';

if (!TOKEN) {
  console.error('Missing TOKEN env variable');
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
    console.error('Command register error:', e.message);
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
      const list = data.bannedWords.slice(0, 50).join(', ') || 'Empty';
      return i.editReply('```' + list + '```');
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
      return i.editReply('Removed from whitelist: ' + u.tag);
    }
  } catch (e) {
    console.error('Interaction error:', e.message);
    try { await i.editReply('Error occurred').catch(() => {}); } catch {}
  }
});

client.login(TOKEN).catch(e => console.error('Login failed:', e.message));

// ===== DASHBOARD =====
const app = express();
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'dashboard', 'views'));
app.use(express.urlencoded({ extended: true }));
app.use(session({ secret: SESSION_SECRET, resave: false, saveUninitialized: false, cookie: { maxAge: 86400000 } }));
app.use(passport.initialize());
app.use(passport.session());

if (CLIENT_ID && CLIENT_SECRET) {
  passport.use(new DiscordStrategy({
    clientID: CLIENT_ID,
    clientSecret: CLIENT_SECRET,
    callbackURL: CALLBACK_URL,
    scope: ['identify']
  }, (accessToken, refreshToken, profile, done) => done(null, profile)));
  passport.serializeUser((u, done) => done(null, u));
  passport.deserializeUser((u, done) => done(null, u));
}

function ensureOwner(req, res, next) {
  if (!req.isAuthenticated()) return res.redirect('/login');
  if (OWNER_ID && req.user.id !== OWNER_ID) {
    return res.status(403).send('<h1 style="text-align:center;margin-top:80px;color:#e74c3c">Access Denied</h1>');
  }
  next();
}

app.get('/', (req, res) => res.redirect(req.isAuthenticated() ? '/dashboard' : '/login'));

app.get('/login', (req, res) => {
  if (!CLIENT_ID) return res.send('<h2 style="text-align:center;margin-top:80px">Set CLIENT_ID, CLIENT_SECRET, OWNER_ID in Railway Variables</h2>');
  res.send(`<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Login</title>
  <style>body{font-family:Tahoma;background:#0f0f13;color:#fff;display:flex;justify-content:center;align-items:center;height:100vh;margin:0}
  .box{background:#1a1a24;padding:40px;border-radius:16px;text-align:center}
  a{background:#5865F2;color:#fff;padding:14px 28px;border-radius:8px;text-decoration:none;font-weight:bold;display:inline-block;margin-top:16px}
  </style></head><body><div class="box"><h1>Bot Dashboard</h1>
  <p>Private access only</p><a href="/auth/discord">Login with Discord</a></div></body></html>`);
});

app.get('/auth/discord', passport.authenticate('discord'));
app.get('/auth/callback', passport.authenticate('discord', { failureRedirect: '/login' }), (req, res) => res.redirect('/dashboard'));
app.get('/logout', (req, res) => { req.logout(() => res.redirect('/login')); });

app.get('/dashboard', ensureOwner, (req, res) => {
  res.render('dashboard', {
    user: req.user,
    bannedWords: data.bannedWords || [],
    whitelist: data.whitelist || [],
    logChannelId: data.logChannelId || '',
    botTag: client.user ? client.user.tag : 'Connecting...'
  });
});

app.post('/dashboard/addword', ensureOwner, (req, res) => {
  const word = (req.body.word || '').trim().toLowerCase();
  if (word && !data.bannedWords.includes(word)) { data.bannedWords.push(word); saveData(); }
  res.redirect('/dashboard');
});
app.post('/dashboard/removeword', ensureOwner, (req, res) => {
  data.bannedWords = data.bannedWords.filter(w => w !== (req.body.word || '').trim().toLowerCase());
  saveData();
  res.redirect('/dashboard');
});
app.post('/dashboard/setlog', ensureOwner, (req, res) => {
  data.logChannelId = (req.body.channelId || '').trim();
  saveData();
  res.redirect('/dashboard');
});
app.post('/dashboard/whitelist', ensureOwner, (req, res) => {
  const id = (req.body.userId || '').trim();
  if (id && !data.whitelist.includes(id)) { data.whitelist.push(id); saveData(); }
  res.redirect('/dashboard');
});
app.post('/dashboard/unwhitelist', ensureOwner, (req, res) => {
  data.whitelist = data.whitelist.filter(x => x !== (req.body.userId || '').trim());
  saveData();
  res.redirect('/dashboard');
});

app.listen(PORT, '0.0.0.0', () => {
  console.log('Dashboard running on port', PORT);
});
