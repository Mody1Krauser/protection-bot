
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
let data = {
  bannedWords: [],
  whitelist: [],
  logChannelId: '',
  antiSpam: true,
  antiCaps: true,
  antiInvites: true,
  maxMentions: 5
};
try {
  if (fs.existsSync(dataPath)) {
    data = { ...data, ...JSON.parse(fs.readFileSync(dataPath, 'utf8')) };
  }
} catch (e) {}

function saveData() {
  try { fs.writeFileSync(dataPath, JSON.stringify(data, null, 2)); } catch (e) {}
}

// ========== كشف ذكي للكلام ==========
function normalizeText(text) {
  if (!text) return '';
  let t = text.toLowerCase();
  const map = {
    'أ': 'ا', 'إ': 'ا', 'آ': 'ا', 'ة': 'ه', 'ى': 'ي', 'ؤ': 'و', 'ئ': 'ي',
    '0': 'o', '1': 'i', '3': 'e', '4': 'a', '5': 's', '7': 't', '8': 'b', '9': 'g',
    '@': 'a', '$': 's', '!': 'i', '|': 'i',
    'к': 'k', 'а': 'a', 'е': 'e', 'о': 'o', 'р': 'p', 'с': 'c', 'у': 'y', 'х': 'x',
  };
  for (const [from, to] of Object.entries(map)) {
    t = t.split(from).join(to);
  }
  t = t
    .replace(/[\s\-_\.\,\;\:\!\?\*\+\=\~`'"\\\/\(\)\[\]\{\}\<\>\|]/g, '')
    .replace(/[^\u0600-\u06FFa-z0-9]/g, '');
  return t;
}

function containsBannedWord(content) {
  const normalized = normalizeText(content);
  if (!normalized) return null;
  for (const word of data.bannedWords) {
    const nw = normalizeText(word);
    if (!nw) continue;
    if (normalized.includes(nw)) return word;
  }
  return null;
}

const spamMap = new Map();
const joinMap = new Map();
const actionTracker = new Map();

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
  new SlashCommandBuilder().setName('addword').setDescription('إضافة كلمة ممنوعة')
    .addStringOption(o => o.setName('word').setDescription('الكلمة').setRequired(true))
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
  new SlashCommandBuilder().setName('removeword').setDescription('حذف كلمة ممنوعة')
    .addStringOption(o => o.setName('word').setDescription('الكلمة').setRequired(true))
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
  new SlashCommandBuilder().setName('listwords').setDescription('عرض الكلمات الممنوعة')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
  new SlashCommandBuilder().setName('setlog').setDescription('تحديد روم اللوقات')
    .addChannelOption(o => o.setName('channel').setDescription('الروم').setRequired(true))
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
  new SlashCommandBuilder().setName('whitelist').setDescription('إضافة للقائمة البيضاء')
    .addUserOption(o => o.setName('user').setDescription('الشخص').setRequired(true))
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
  new SlashCommandBuilder().setName('unwhitelist').setDescription('إزالة من القائمة البيضاء')
    .addUserOption(o => o.setName('user').setDescription('الشخص').setRequired(true))
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
  new SlashCommandBuilder().setName('settings').setDescription('عرض إعدادات الحماية')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
  new SlashCommandBuilder().setName('clear').setDescription('حذف رسائل من الروم')
    .addIntegerOption(o => o.setName('amount').setDescription('عدد الرسائل (1-100)').setRequired(true).setMinValue(1).setMaxValue(100))
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages)
];

client.once('clientReady', async () => {
  console.log('Bot online:', client.user.tag);
  client.user.setActivity('Smart Protection', { type: 3 });
  try {
    const rest = new REST({ version: '10' }).setToken(TOKEN);
    await rest.put(Routes.applicationCommands(client.user.id), { body: commands });
    console.log('Commands registered');
  } catch (e) {
    console.error('Command error:', e.message);
  }
});

async function logAction(guild, title, description, color = 0xFF0000) {
  if (!data.logChannelId) return;
  const ch = guild.channels.cache.get(data.logChannelId);
  if (!ch) return;
  const embed = new EmbedBuilder().setColor(color).setTitle(title).setDescription(description).setTimestamp();
  await ch.send({ embeds: [embed] }).catch(() => {});
}

client.on('messageCreate', async (message) => {
  try {
    if (message.author.bot || !message.guild) return;
    if (data.whitelist.includes(message.author.id)) return;
    if (message.member?.permissions?.has(PermissionFlagsBits.Administrator)) return;

    const content = message.content;

    // 1) فلتر شتائم ذكي
    const found = containsBannedWord(content);
    if (found) {
      await message.delete().catch(() => {});
      try { await message.member.timeout(5 * 60 * 1000, 'Banned word'); } catch {}
      await logAction(message.guild, 'كلمة ممنوعة', `العضو: ${message.author}\nالكلمة: ||${found}||\nالرسالة: ||${content.slice(0, 100)}||`);
      return;
    }

    // 2) دعوات وروابط مشبوهة
    if (data.antiInvites !== false) {
      const inviteRegex = /(discord\.gg\/|discord\.com\/invite\/|discordapp\.com\/invite\/)/i;
      const badLink = /(discord\.gift|free.?nitro|steamcommunity\.ru|disc0rd|bit\.ly\/)/i;
      if (inviteRegex.test(content) || badLink.test(content)) {
        await message.delete().catch(() => {});
        try { await message.member.timeout(10 * 60 * 1000, 'Invite / bad link'); } catch {}
        await logAction(message.guild, 'رابط/دعوة محذوفة', `العضو: ${message.author}\n${content.slice(0, 150)}`, 0xFFA500);
        return;
      }
    }

    // 3) سبام
    if (data.antiSpam !== false) {
      const key = message.author.id;
      const now = Date.now();
      if (!spamMap.has(key)) spamMap.set(key, []);
      const times = spamMap.get(key).filter(t => now - t < 5000);
      times.push(now);
      spamMap.set(key, times);
      if (times.length >= 6) {
        await message.delete().catch(() => {});
        try { await message.member.timeout(3 * 60 * 1000, 'Spam'); } catch {}
        await logAction(message.guild, 'سبام', `العضو: ${message.author}\n${times.length} رسائل خلال 5 ثواني`, 0xFFA500);
        spamMap.set(key, []);
        return;
      }
    }

    // 4) كابس مفرط
    if (data.antiCaps !== false && content.length > 12) {
      const letters = content.replace(/[^a-zA-Z\u0600-\u06FF]/g, '');
      if (letters.length > 10) {
        const upper = (content.match(/[A-Z]/g) || []).length;
        if (upper / letters.length > 0.7) {
          await message.delete().catch(() => {});
          await logAction(message.guild, 'كابس مفرط', `العضو: ${message.author}\n${content.slice(0, 100)}`, 0xFFA500);
          return;
        }
      }
    }

    // 5) منشن جماعي
    const maxMentions = data.maxMentions || 5;
    const mentionCount = (message.mentions.users.size || 0) + (message.mentions.roles.size || 0);
    if (mentionCount >= maxMentions) {
      await message.delete().catch(() => {});
      try { await message.member.timeout(5 * 60 * 1000, 'Mass mention'); } catch {}
      await logAction(message.guild, 'منشن جماعي', `العضو: ${message.author}\nالعدد: ${mentionCount}`, 0xFFA500);
      return;
    }
  } catch (e) {
    console.error('messageCreate error:', e.message);
  }
});

// Anti-Nuke
client.on('channelDelete', async (channel) => {
  try {
    if (!channel.guild) return;
    const audit = await channel.guild.fetchAuditLogs({ type: 12, limit: 1 }).catch(() => null);
    if (!audit) return;
    const entry = audit.entries.first();
    if (!entry || entry.executor.bot || Date.now() - entry.createdTimestamp > 5000) return;
    if (data.whitelist.includes(entry.executor.id)) return;
    const key = entry.executor.id + '-ch';
    const count = (actionTracker.get(key) || 0) + 1;
    actionTracker.set(key, count);
    setTimeout(() => actionTracker.delete(key), 10000);
    if (count >= 3) {
      const member = await channel.guild.members.fetch(entry.executor.id).catch(() => null);
      if (member) {
        await member.roles.set([]).catch(() => {});
        await member.ban({ reason: 'Anti-Nuke' }).catch(() => {});
        await logAction(channel.guild, 'Anti-Nuke', `تم بان ${entry.executor.tag}`);
      }
    }
  } catch (e) {}
});

// Anti-Raid
client.on('guildMemberAdd', async (member) => {
  try {
    const gid = member.guild.id;
    const now = Date.now();
    if (!joinMap.has(gid)) joinMap.set(gid, []);
    const joins = joinMap.get(gid).filter(t => now - t < 15000);
    joins.push(now);
    joinMap.set(gid, joins);
    if (joins.length >= 8) {
      try { await member.timeout(10 * 60 * 1000, 'Possible raid'); } catch {}
      await logAction(member.guild, 'Anti-Raid', `دخول جماعي (${joins.length})\n${member.user.tag}`, 0x9B59B6);
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
      return i.editReply('تمت إضافة: **' + word + '**');
    }
    if (i.commandName === 'removeword') {
      const word = i.options.getString('word').toLowerCase();
      data.bannedWords = data.bannedWords.filter(w => w !== word); saveData();
      return i.editReply('تم حذف: **' + word + '**');
    }
    if (i.commandName === 'listwords') {
      return i.editReply('```' + (data.bannedWords.slice(0, 50).join(', ') || 'فارغة') + '```');
    }
    if (i.commandName === 'setlog') {
      data.logChannelId = i.options.getChannel('channel').id; saveData();
      return i.editReply('تم تحديد روم اللوقات');
    }
    if (i.commandName === 'whitelist') {
      const u = i.options.getUser('user');
      if (!data.whitelist.includes(u.id)) { data.whitelist.push(u.id); saveData(); }
      return i.editReply('تم إضافة ' + u.tag);
    }
    if (i.commandName === 'unwhitelist') {
      const u = i.options.getUser('user');
      data.whitelist = data.whitelist.filter(id => id !== u.id); saveData();
      return i.editReply('تم إزالة ' + u.tag);
    }
    if (i.commandName === 'settings') {
      return i.editReply(
        '**إعدادات الحماية:**\n' +
        '• فلتر شتائم ذكي: نعم\n' +
        '• Anti-Spam: ' + (data.antiSpam !== false ? 'نعم' : 'لا') + '\n' +
        '• Anti-Caps: ' + (data.antiCaps !== false ? 'نعم' : 'لا') + '\n' +
        '• Anti-Invites: ' + (data.antiInvites !== false ? 'نعم' : 'لا') + '\n' +
        '• Max Mentions: ' + (data.maxMentions || 5) + '\n' +
        '• كلمات: ' + data.bannedWords.length
      );
    }
    if (i.commandName === 'clear') {
      const amount = i.options.getInteger('amount');
      if (!i.channel.permissionsFor(i.guild.members.me).has(PermissionFlagsBits.ManageMessages)) {
        return i.editReply('ما عندي صلاحية Manage Messages');
      }
      const deleted = await i.channel.bulkDelete(amount, true).catch(() => null);
      if (!deleted) {
        return i.editReply('فشل الحذف (ممكن الرسائل أقدم من 14 يوم)');
      }
      return i.editReply('تم حذف **' + deleted.size + '** رسالة');
    }
  } catch (e) {
    console.error('Interaction error:', e.message);
  }
});

client.login(TOKEN).catch(e => console.error('Login failed:', e.message));

// ===== DASHBOARD =====
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
  const error = req.query.error ? '<p style="color:#ff6b6b">كلمة السر غلط</p>' : '';
  res.send(`<!DOCTYPE html><html lang="ar" dir="rtl"><head><meta charset="UTF-8"><title>Login</title>
  <style>
  body{font-family:Tahoma;background:#0f0f13;color:#fff;display:flex;justify-content:center;align-items:center;height:100vh;margin:0}
  .box{background:#1a1a24;padding:40px;border-radius:16px;text-align:center;width:320px}
  input{width:100%;padding:12px;margin:12px 0;border-radius:8px;border:1px solid #333;background:#0f0f18;color:#fff;box-sizing:border-box}
  button{width:100%;padding:12px;border:none;border-radius:8px;background:#5865F2;color:#fff;font-weight:bold;cursor:pointer;margin-top:8px}
  </style></head><body><div class="box">
  <h1>Bot Dashboard</h1>${error}
  <form method="POST" action="/login">
    <input type="password" name="password" placeholder="كلمة السر" required autofocus>
    <button type="submit">دخول</button>
  </form></div></body></html>`);
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
    botTag: client.user ? client.user.tag : 'Connecting...',
    antiSpam: data.antiSpam !== false,
    antiCaps: data.antiCaps !== false,
    antiInvites: data.antiInvites !== false,
    maxMentions: data.maxMentions || 5
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
app.post('/dashboard/toggles', requireAuth, (req, res) => {
  data.antiSpam = req.body.antiSpam === 'on';
  data.antiCaps = req.body.antiCaps === 'on';
  data.antiInvites = req.body.antiInvites === 'on';
  data.maxMentions = parseInt(req.body.maxMentions) || 5;
  saveData();
  res.redirect('/dashboard');
});

app.listen(PORT, '0.0.0.0', () => {
  console.log('Dashboard running on port', PORT);
});
