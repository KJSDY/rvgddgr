// index.js — All-in-one (Guild commands)
// Requirements: discord.js v14, Node 18+

const fs = require('fs');
const path = require('path');
const {
  Client,
  GatewayIntentBits,
  Partials,
  REST,
  Routes,
  SlashCommandBuilder,
  ActionRowBuilder,
  StringSelectMenuBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  PermissionFlagsBits,
  ChannelType,
  Events
} = require('discord.js');

const config = require('./config.json');

// config must include at least:
// token, clientId (optional), guildId, ticketCategory, logChannel, welcomeChannel, admins (array), embedColor, footerText, rolesToMention (array)

const TOKEN = config.token;
const CLIENT_ID = config.clientId || '';
const GUILD_ID = config.guildId;

// Create client
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent
  ],
  partials: [Partials.Channel, Partials.Message, Partials.GuildMember]
});

// ----- Slash commands definition (guild) -----
const commands = [
  new SlashCommandBuilder().setName('ping').setDescription('Check bot ping'),
  new SlashCommandBuilder()
    .setName('guess')
    .setDescription('Guess number 1-10')
    .addIntegerOption(opt => opt.setName('number').setDescription('Your guess 1-10').setRequired(true)),
  new SlashCommandBuilder().setName('setup_ticket').setDescription('Create ticket panel (embed + menu + button)'),
  new SlashCommandBuilder().setName('verify_setup').setDescription('Create verify panel (button)') // optional admin
].map(c => c.toJSON());

const rest = new REST({ version: '10' }).setToken(TOKEN);

// register guild commands once on ready to avoid duplication/race
client.once(Events.ClientReady, async () => {
  console.log(`${client.user.tag} Online ✓`);

  try {
    // prefer client.user.id if available, fallback to config.clientId
    const appId = client.user?.id || CLIENT_ID;
    if (!appId || !GUILD_ID) {
      console.warn('Missing clientId or guildId in config — slash registration skipped.');
      return;
    }
    await rest.put(Routes.applicationGuildCommands(appId, GUILD_ID), { body: commands });
    console.log('Slash commands registered (guild) ✓');
  } catch (err) {
    console.error('Failed to register slash commands:', err);
  }
});

// ---------- Utilities ----------
function isAdmin(id) {
  if (!Array.isArray(config.admins)) return false;
  return config.admins.includes(String(id));
}

async function safeReply(interaction, options) {
  // reply or edit depending on state; used to avoid Unknown Interaction
  if (interaction.replied || interaction.deferred) {
    try { return await interaction.editReply(options); } catch (e) { /* ignore */ }
  } else {
    try { return await interaction.reply(options); } catch (e) { /* fallback */ }
  }
}

// ---------- Welcome & Logs ----------
client.on(Events.GuildMemberAdd, member => {
  try {
    const ch = member.guild.channels.cache.get(config.welcomeChannel);
    if (!ch) return;
    const embed = new EmbedBuilder()
      .setTitle('Welcome 🎉')
      .setDescription(`${member} نورت السيرفر!`)
      .setColor(config.embedColor || '#2b2d31')
      .setFooter({ text: config.footerText || '' })
      .setTimestamp();
    ch.send({ embeds: [embed] }).catch(() => {});
    // log join
    const log = member.guild.channels.cache.get(config.logChannel);
    if (log) log.send(`➡️ ${member.user.tag} joined the server.`);
  } catch (e) {}
});

client.on(Events.GuildMemberRemove, member => {
  try {
    const log = member.guild.channels.cache.get(config.logChannel);
    if (log) log.send(`⬅️ ${member.user.tag} left the server.`);
  } catch (e) {}
});

client.on(Events.MessageDelete, message => {
  try {
    if (!message.guild) return;
    const log = message.guild.channels.cache.get(config.logChannel);
    if (!log) return;
    const author = message.author ? `${message.author.tag}` : 'Unknown';
    log.send(`🗑️ Deleted message by ${author}: ${message.content || '[embed/attachment]'}`);
  } catch (e) {}
});

// ---------- Interaction Handler (slash, menus, buttons) ----------
client.on(Events.InteractionCreate, async interaction => {
  try {
    // ---------- Slash commands ----------
    if (interaction.isChatInputCommand()) {
      const name = interaction.commandName;

      if (name === 'ping') {
        return interaction.reply({ content: `Pong! ${client.ws.ping}ms`, ephemeral: true });
      }

      if (name === 'guess') {
        const guess = interaction.options.getInteger('number');
        const answer = Math.floor(Math.random() * 10) + 1;
        return interaction.reply({ content: guess === answer ? `🎉 صح! الرقم ${answer}` : `❌ غلط! الرقم ${answer}`, ephemeral: true });
      }

      if (name === 'setup_ticket') {
        // admin only? allow anyone who has ManageGuild
        if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild) && !isAdmin(interaction.user.id)) {
          await interaction.reply({ content: 'رسالة: لا تملك صلاحية تنفيذ هذا الأمر.', ephemeral: true });
          return;
        }

        const embed = new EmbedBuilder()
          .setTitle(config.ticketTitle || '🎫 نظام التذاكر')
          .setDescription(config.ticketMessage || 'اختر نوع التذكرة من القائمة أو اضغط الزر')
          .setColor(config.embedColor || '#2b2d31')
          .setFooter({ text: config.footerText || '' });

        const menu = new StringSelectMenuBuilder()
          .setCustomId('ticket_menu')
          .setPlaceholder('اختر نوع التذكرة')
          .addOptions([
            { label: 'دعم فني', value: 'support' },
            { label: 'شراء', value: 'buy' },
            { label: 'تبليغ', value: 'report' }
          ]);

        const menuRow = new ActionRowBuilder().addComponents(menu);
        const btnRow = new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId('ticket_button').setLabel('فتح تذكرة').setStyle(ButtonStyle.Primary)
        );

        await interaction.reply({ content: 'تم إنشاء لوحة التذاكر ✓', ephemeral: true });
        return interaction.channel.send({ embeds: [embed], components: [menuRow, btnRow] });
      }

      if (name === 'verify_setup') {
        if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild) && !isAdmin(interaction.user.id)) {
          await interaction.reply({ content: 'لا تملك صلاحية.', ephemeral: true });
          return;
        }
        const embed = new EmbedBuilder().setTitle('تحقق').setDescription('اضغط الزر للحصول على التحقق').setColor(config.embedColor || '#2b2d31');
        const row = new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId('verify_button').setLabel('تحقق').setStyle(ButtonStyle.Success)
        );
        await interaction.reply({ content: 'تم إنشاء لوحة التحقق ✓', ephemeral: true });
        return interaction.channel.send({ embeds: [embed], components: [row] });
      }
    }

    // ---------- Select Menu (ticket reasons) ----------
    if (interaction.isStringSelectMenu()) {
      if (interaction.customId === 'ticket_menu') {
        await interaction.deferReply({ ephemeral: true });
        const type = interaction.values[0];
        return createTicket(interaction, type);
      }
    }

    // ---------- Buttons ----------
    if (interaction.isButton()) {
      // verify button
      if (interaction.customId === 'verify_button') {
        await interaction.deferReply({ ephemeral: true });
        const roleId = config.verifyRole; // must be set in config.json
        if (!roleId) return interaction.editReply({ content: 'لم يتم إعداد دور التحقق.' });
        const member = interaction.member;
        if (member.roles.cache.has(roleId)) {
          return interaction.editReply({ content: 'أنت مُحقق بالفعل.' });
        }
        await member.roles.add(roleId).catch(() => {});
        return interaction.editReply({ content: 'تم منحك دور التحقق ✓' });
      }

      // open ticket button
      if (interaction.customId === 'ticket_button') {
        await interaction.deferReply({ ephemeral: true });
        return createTicket(interaction, 'general');
      }

      // close ticket button
      if (interaction.customId === 'close_ticket') {
        await interaction.deferReply({ ephemeral: true });
        const ch = interaction.channel;
        await interaction.editReply({ content: 'سيتم إغلاق التذكرة خلال 5 ثوانٍ...' }).catch(() => {});
        setTimeout(async () => {
          // transcript: save messages to a text file and post to log channel
          try {
            const msgs = await ch.messages.fetch({ limit: 100 });
            const lines = msgs.map(m => `[${new Date(m.createdTimestamp).toISOString()}] ${m.author.tag}: ${m.content || '[embed/attachment]'}`).reverse().join('\n');
            const filename = `transcript-${ch.id}.txt`;
            fs.writeFileSync(filename, lines, 'utf8');

            // send transcript to logChannel if configured
            if (config.logChannel) {
              const logCh = ch.guild.channels.cache.get(config.logChannel);
              if (logCh) {
                await logCh.send({ content: `Transcript for ${ch.name} (closed by ${interaction.user.tag})`, files: [filename] }).catch(() => {});
              }
            }
            // delete channel
            await ch.delete().catch(() => {});
            // cleanup file
            fs.unlinkSync(filename);
          } catch (e) {
            // try still to delete channel
            await ch.delete().catch(() => {});
          }
        }, 5000);
        return;
      }
    }
  } catch (err) {
    console.error('Interaction handler error:', err);
    if (interaction && !interaction.replied && !interaction.deferred) {
      try { await interaction.reply({ content: 'حدث خطأ، حاول لاحقاً.', ephemeral: true }); } catch (e) {}
    }
  }
});

// ---------- createTicket helper ----------
async function createTicket(interaction, type) {
  try {
    const guild = interaction.guild;
    const user = interaction.user;

    // prevent duplicates: check if user already has a channel starting with ticket-username (case-insensitive)
    const existing = guild.channels.cache.find(c => c.name.toLowerCase() === `ticket-${user.username.toLowerCase()}`);
    if (existing) {
      // interaction was deferred in caller, edit reply
      return interaction.editReply({ content: `لديك تذكرة مفتوحة: ${existing}`, ephemeral: true });
    }

    // create channel under configured category (ticketCategory)
    const opts = {
      name: `ticket-${user.username}`.toLowerCase(),
      type: ChannelType.GuildText,
      permissionOverwrites: [
        { id: guild.id, deny: [PermissionFlagsBits.ViewChannel] },
        { id: user.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages] }
      ]
    };
    if (config.ticketCategory) opts.parent = config.ticketCategory;

    // give handlers role access if configured
    if (Array.isArray(config.handlersRole) && config.handlersRole.length) {
      for (const rid of config.handlersRole) {
        opts.permissionOverwrites.push({ id: rid, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages] });
      }
    } else if (config.handlersRole) {
      opts.permissionOverwrites.push({ id: config.handlersRole, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages] });
    }

    const ch = await guild.channels.create(opts);

    const embed = new EmbedBuilder()
      .setTitle('🎟️ تذكرتك')
      .setDescription(`منشأة بواسطة ${user}\n**السبب:** ${type}`)
      .setColor(config.embedColor || '#2b2d31')
      .setFooter({ text: config.footerText || '' })
      .setTimestamp();

    const closeRow = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('close_ticket').setLabel('إغلاق التذكرة').setStyle(ButtonStyle.Danger)
    );

    // mention roles if any
    let content = `<@${user.id}>`;
    if (Array.isArray(config.rolesToMention) && config.rolesToMention.length) {
      content += ' ' + config.rolesToMention.map(r => `<@&${r}>`).join(' ');
    }

    await ch.send({ content, embeds: [embed], components: [closeRow] });

    // log
    if (config.logChannel) {
      const log = guild.channels.cache.get(config.logChannel);
      if (log) log.send(`🎫 تذكرة جديدة من ${user.tag} — ${ch}`);
    }

    // reply to interaction (caller deferred earlier)
    return interaction.editReply({ content: `✔ تم إنشاء التذكرة: ${ch}`, ephemeral: true });
  } catch (e) {
    console.error('createTicket error:', e);
    if (!interaction.replied && !interaction.deferred) {
      try { return interaction.reply({ content: 'خطأ أثناء إنشاء التذكرة.', ephemeral: true }); } catch (e) {}
    } else {
      try { return interaction.editReply({ content: 'خطأ أثناء إنشاء التذكرة.', ephemeral: true }); } catch (e) {}
    }
  }
}

// ---------- Prefix admin commands (simple) ----------
client.on(Events.MessageCreate, async message => {
  if (!message.guild) return;
  if (message.author.bot) return;
  if (!message.content.startsWith(config.prefix || '!')) return;

  const args = message.content.slice((config.prefix || '!').length).trim().split(/ +/);
  const cmd = args.shift().toLowerCase();

  // only allow admins from config or permissions
  const allow = isAdmin(message.author.id) || message.member.permissions.has(PermissionFlagsBits.ManageGuild);

  if (cmd === 'clear' && allow) {
    const amt = parseInt(args[0]) || 5;
    await message.channel.bulkDelete(Math.min(amt, 100)).catch(() => {});
    const m = await message.channel.send(`✔ تم مسح ${amt} رسالة`);
    setTimeout(() => m.delete().catch(() => {}), 3000);
  }

  if (cmd === 'ban' && allow) {
    const member = message.mentions.members.first();
    if (!member) return message.reply('منشن الشخص');
    await member.ban({ reason: `Banned by ${message.author.tag}` }).catch(e => message.reply('فشل الحظر'));
    message.reply('✔ تم الحظر');
  }

  if (cmd === 'kick' && allow) {
    const member = message.mentions.members.first();
    if (!member) return message.reply('منشن الشخص');
    await member.kick().catch(e => message.reply('فشل الطرد'));
    message.reply('✔ تم الطرد');
  }
});

// ---------- Login ----------
client.login(TOKEN).catch(err => {
  console.error('Failed to login:', err);
});
