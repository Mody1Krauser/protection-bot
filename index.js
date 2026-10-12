const { Client, GatewayIntentBits, Partials, EmbedBuilder, PermissionFlagsBits, SlashCommandBuilder, REST, Routes } = require('discord.js');
const fs = require('fs');
const path = require('path');

// التوكن من Environment Variable (مهم لـ Railway)
const TOKEN = process.env.TOKEN || process.env.DISCORD_TOKEN;
const CLIENT_ID = process.env.CLIENT_ID || "";

if (!TOKEN) {
    console.error("❌ خطأ: لم يتم العثور على التوكن!");
    console.error("تأكد من إضافة متغير البيئة TOKEN في Railway");
    process.exit(1);
}

// تحميل البيانات
const dataPath = path.join(__dirname, 'data.json');
let data = { bannedWords: [], whitelist: [] };
let logChannelId = process.env.LOG_CHANNEL_ID || "";

try {
    if (fs.existsSync(dataPath)) {
        data = JSON.parse(fs.readFileSync(dataPath, 'utf8'));
    }
} catch (err) {
    console.log("تم إنشاء data.json جديد");
}

function saveData() {
    try {
        fs.writeFileSync(dataPath, JSON.stringify(data, null, 2));
    } catch (err) {
        console.error("خطأ في حفظ البيانات:", err.message);
    }
}

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

// ========== تسجيل الأوامر ==========
const commands = [
    new SlashCommandBuilder()
        .setName('addword')
        .setDescription('إضافة كلمة ممنوعة')
        .addStringOption(opt => opt.setName('word').setDescription('الكلمة').setRequired(true))
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

    new SlashCommandBuilder()
        .setName('removeword')
        .setDescription('حذف كلمة ممنوعة')
        .addStringOption(opt => opt.setName('word').setDescription('الكلمة').setRequired(true))
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

    new SlashCommandBuilder()
        .setName('listwords')
        .setDescription('عرض كل الكلمات الممنوعة')
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

    new SlashCommandBuilder()
        .setName('setlog')
        .setDescription('تحديد روم اللوقات')
        .addChannelOption(opt => opt.setName('channel').setDescription('الروم').setRequired(true))
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

    new SlashCommandBuilder()
        .setName('whitelist')
        .setDescription('إضافة شخص للقائمة البيضاء')
        .addUserOption(opt => opt.setName('user').setDescription('الشخص').setRequired(true))
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

    new SlashCommandBuilder()
        .setName('unwhitelist')
        .setDescription('إزالة شخص من القائمة البيضاء')
        .addUserOption(opt => opt.setName('user').setDescription('الشخص').setRequired(true))
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
];

const rest = new REST({ version: '10' }).setToken(TOKEN);

(async () => {
    try {
        console.log('جاري تسجيل الأوامر...');
        // تسجيل الأوامر عالمياً
        await rest.put(Routes.applicationCommands(client.user?.id || process.env.CLIENT_ID || "0"), { body: commands });
        console.log('تم تسجيل الأوامر!');
    } catch (err) {
        // سنسجل الأوامر بعد الـ ready
        console.log('سيتم تسجيل الأوامر بعد الاتصال...');
    }
})();

client.once('ready', async () => {
    console.log(`✅ البوت شغال باسم: ${client.user.tag}`);
    client.user.setActivity('حماية السيرفر 🛡️', { type: 3 });

    // تسجيل الأوامر بعد الاتصال
    try {
        await rest.put(Routes.applicationCommands(client.user.id), { body: commands });
        console.log('✅ تم تسجيل الأوامر بنجاح');
    } catch (err) {
        console.error('خطأ في تسجيل الأوامر:', err.message);
    }
});

// ========== فلتر الشتائم + الروابط ==========
client.on('messageCreate', async (message) => {
    if (message.author.bot || !message.guild) return;
    if (data.whitelist.includes(message.author.id)) return;
    if (message.member?.permissions.has(PermissionFlagsBits.Administrator)) return;

    const content = message.content.toLowerCase();

    // فحص الشتائم
    const foundWord = data.bannedWords.find(word => content.includes(word.toLowerCase()));
    if (foundWord) {
        await message.delete().catch(() => {});

        try {
            await message.member.timeout(5 * 60 * 1000, `استخدام كلمة ممنوعة: ${foundWord}`);
        } catch {}

        const embed = new EmbedBuilder()
            .setColor(0xFF0000)
            .setTitle('🚫 تم حذف رسالة')
            .setDescription(`**العضو:** ${message.author}\n**السبب:** كلمة ممنوعة\n**الكلمة:** ||${foundWord}||`)
            .setTimestamp();

        if (logChannelId) {
            const logChannel = message.guild.channels.cache.get(logChannelId);
            if (logChannel) logChannel.send({ embeds: [embed] }).catch(() => {});
        }

        const warnMsg = await message.channel.send({
            content: `${message.author} تم حذف رسالتك بسبب استخدام كلام ممنوع.`,
            allowedMentions: { users: [message.author.id] }
        }).catch(() => null);

        if (warnMsg) setTimeout(() => warnMsg.delete().catch(() => {}), 5000);
        return;
    }

    // فحص الروابط الضارة
    const urlRegex = /(https?:\/\/[^\s]+)/gi;
    const urls = message.content.match(urlRegex);
    if (urls) {
        const badPatterns = [
            /discord\.gift/i, /discordnitro/i, /free.?nitro/i, /steamcommunity\.ru/i,
            /discord-app/i, /disc0rd/i, /d1scord/i, /nitro.?free/i, /steancommunity/i,
            /bit\.ly/i, /tinyurl/i, /cutt\.ly/i
        ];

        const isBad = urls.some(url => badPatterns.some(p => p.test(url)));
        if (isBad) {
            await message.delete().catch(() => {});

            try {
                await message.member.timeout(10 * 60 * 1000, 'إرسال رابط مشبوه');
            } catch {}

            const embed = new EmbedBuilder()
                .setColor(0xFFA500)
                .setTitle('⚠️ رابط مشبوه تم حذفه')
                .setDescription(`**العضو:** ${message.author}\n**الرابط:** ${urls[0]}`)
                .setTimestamp();

            if (logChannelId) {
                const logChannel = message.guild.channels.cache.get(logChannelId);
                if (logChannel) logChannel.send({ embeds: [embed] }).catch(() => {});
            }
        }
    }
});

// ========== Anti-Nuke بسيط ==========
const actionTracker = new Map();

client.on('channelDelete', async (channel) => {
    if (!channel.guild) return;
    const audit = await channel.guild.fetchAuditLogs({ type: 12, limit: 1 }).catch(() => null);
    if (!audit) return;

    const entry = audit.entries.first();
    if (!entry || entry.executor.bot || Date.now() - entry.createdTimestamp > 5000) return;
    if (data.whitelist.includes(entry.executor.id)) return;

    const key = `${entry.executor.id}-channel`;
    const count = (actionTracker.get(key) || 0) + 1;
    actionTracker.set(key, count);
    setTimeout(() => actionTracker.delete(key), 10000);

    if (count >= 3) {
        const member = await channel.guild.members.fetch(entry.executor.id).catch(() => null);
        if (member) {
            await member.roles.set([]).catch(() => {});
            await member.ban({ reason: 'Anti-Nuke: حذف قنوات كثيرة' }).catch(() => {});

            if (logChannelId) {
                const logChannel = channel.guild.channels.cache.get(logChannelId);
                if (logChannel) {
                    logChannel.send(`🚨 **Anti-Nuke**\nتم بان ${entry.executor.tag} بسبب حذف قنوات كثيرة.`).catch(() => {});
                }
            }
        }
    }
});

// ========== الأوامر ==========
client.on('interactionCreate', async (interaction) => {
    if (!interaction.isChatInputCommand()) return;

    if (interaction.commandName === 'addword') {
        const word = interaction.options.getString('word').toLowerCase();
        if (data.bannedWords.includes(word)) {
            return interaction.reply({ content: '❌ الكلمة موجودة مسبقاً.', ephemeral: true });
        }
        data.bannedWords.push(word);
        saveData();
        return interaction.reply({ content: `✅ تم إضافة الكلمة: **${word}**`, ephemeral: true });
    }

    if (interaction.commandName === 'removeword') {
        const word = interaction.options.getString('word').toLowerCase();
        data.bannedWords = data.bannedWords.filter(w => w !== word);
        saveData();
        return interaction.reply({ content: `✅ تم حذف الكلمة: **${word}**`, ephemeral: true });
    }

    if (interaction.commandName === 'listwords') {
        const list = data.bannedWords.length > 0 
            ? data.bannedWords.slice(0, 50).join(', ') 
            : 'لا توجد كلمات ممنوعة';
        return interaction.reply({ content: `📋 الكلمات الممنوعة:\n\`\`\`${list}\`\`\``, ephemeral: true });
    }

    if (interaction.commandName === 'setlog') {
        const channel = interaction.options.getChannel('channel');
        logChannelId = channel.id;
        return interaction.reply({ content: `✅ تم تحديد روم اللوقات: ${channel}`, ephemeral: true });
    }

    if (interaction.commandName === 'whitelist') {
        const user = interaction.options.getUser('user');
        if (!data.whitelist.includes(user.id)) {
            data.whitelist.push(user.id);
            saveData();
        }
        return interaction.reply({ content: `✅ تم إضافة ${user.tag} للقائمة البيضاء.`, ephemeral: true });
    }

    if (interaction.commandName === 'unwhitelist') {
        const user = interaction.options.getUser('user');
        data.whitelist = data.whitelist.filter(id => id !== user.id);
        saveData();
        return interaction.reply({ content: `✅ تم إزالة ${user.tag} من القائمة البيضاء.`, ephemeral: true });
    }
});

client.login(TOKEN);
