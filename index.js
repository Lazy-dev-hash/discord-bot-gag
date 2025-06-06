const fs = require("fs");
const path = require("path");
const { Client, GatewayIntentBits, Partials, EmbedBuilder, REST, Routes, SlashCommandBuilder } = require("discord.js");
const axios = require("axios");
const { botToken, guildId, prefix } = require("./config");

const footerText = "Created by Sunnel";

const registeredUsersPath = path.join(__dirname, "registeredUsers.json");
let registeredUsers = new Set();

function loadRegisteredUsers() {
  try {
    if (fs.existsSync(registeredUsersPath)) {
      const data = fs.readFileSync(registeredUsersPath, "utf8");
      const arr = JSON.parse(data);
      registeredUsers = new Set(arr);
      console.log(`Loaded ${arr.length} registered users.`);
    }
  } catch (err) {
    console.error("Error loading registered users:", err);
  }
}

function saveRegisteredUsers() {
  try {
    fs.writeFileSync(registeredUsersPath, JSON.stringify([...registeredUsers], null, 2), "utf8");
  } catch (err) {
    console.error("Error saving registered users:", err);
  }
}

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.DirectMessages,
  ],
  partials: [Partials.Channel],
});

const activeSessions = new Map();
const fetchIntervalMs = 10 * 1000; // 10 seconds

const commands = [
  new SlashCommandBuilder().setName("register").setDescription("Register yourself to use the Grow A Garden tracker bot."),
  new SlashCommandBuilder().setName("track").setDescription("Start receiving Grow A Garden stock updates via DM."),
  new SlashCommandBuilder().setName("stop").setDescription("Stop receiving Grow A Garden stock updates."),
].map(cmd => cmd.toJSON());

async function registerCommands() {
  const rest = new REST({ version: "10" }).setToken(botToken);
  try {
    console.log("Started refreshing application (slash) commands.");
    await rest.put(Routes.applicationGuildCommands(client.user.id, guildId), {
      body: commands,
    });
    console.log("Successfully reloaded application (slash) commands.");
  } catch (error) {
    console.error(error);
  }
}

async function createStockEmbed() {
  try {
    const [
      gearSeedRes,
      eggRes,
      weatherRes,
      honeyRes,
      cosmeticsRes,
      seedsEmojiRes,
    ] = await Promise.all([
      axios.get("https://growagardenstock.com/api/stock?type=gear-seeds"),
      axios.get("https://growagardenstock.com/api/stock?type=egg"),
      axios.get("https://growagardenstock.com/api/stock/weather"),
      axios.get("http://65.108.103.151:22377/api/stocks?type=honeyStock"),
      axios.get("https://growagardenstock.com/api/special-stock?type=cosmetics"),
      axios.get("http://65.108.103.151:22377/api/stocks?type=seedsStock"),
    ]);

    const gearSeed = gearSeedRes.data;
    const egg = eggRes.data;
    const weather = weatherRes.data;
    const honey = honeyRes.data;
    const cosmetics = cosmeticsRes.data;
    const emojiSeeds = seedsEmojiRes.data?.seedsStock || [];

    function getCountdown(updatedAt, intervalSec) {
      const now = Date.now();
      const passed = Math.floor((now - updatedAt) / 1000);
      const remaining = Math.max(intervalSec - passed, 0);
      const h = Math.floor(remaining / 3600);
      const m = Math.floor((remaining % 3600) / 60);
      const s = remaining % 60;
      return `${h > 0 ? `${h}h ` : ""}${m}m ${s}s`;
    }

    function getHoneyRestockCountdown() {
      const nowPH = new Date(new Date().toLocaleString("en-US", { timeZone: "Asia/Manila" }));
      const currentMinutes = nowPH.getMinutes();
      const currentSeconds = nowPH.getSeconds();

      const remainingMinutes = 59 - currentMinutes;
      const remainingSeconds = 60 - currentSeconds;

      const m = remainingMinutes < 10 ? `0${remainingMinutes}` : remainingMinutes;
      const s = remainingSeconds < 10 ? `0${remainingSeconds}` : remainingSeconds;

      return `${m}m ${s}s`;
    }

    const gearList = gearSeed.gear?.map(item => `• ${item}`).join("\n") || "No gear.";
    const seedList = gearSeed.seeds?.map(seed => {
      const name = seed.split(" **")[0];
      const matched = emojiSeeds.find(s => s.name.toLowerCase() === name.toLowerCase());
      const emoji = matched?.emoji || "";
      return `• ${emoji ? `${emoji} ` : ""}${seed}`;
    }).join("\n") || "No seeds.";
    const eggList = egg.egg?.map(item => `• ${item}`).join("\n") || "No eggs.";
    const cosmeticsList = cosmetics.cosmetics?.map(item => `• ${item}`).join("\n") || "No cosmetics.";
    const honeyList = honey.honeyStock?.map(h => `• ${h.name}: ${h.value}`).join("\n") || "No honey stock.";

    const weatherIcon = weather.icon || "🌦️";
    const weatherCurrent = weather.currentWeather || "Unknown";
    const cropBonus = weather.cropBonuses || "None";

    const gearRestock = getCountdown(gearSeed.updatedAt, 300);
    const eggRestock = getCountdown(egg.updatedAt, 600);
    const cosmeticsRestock = getCountdown(cosmetics.updatedAt, 14400);
    const honeyRestock = getHoneyRestockCountdown();

    const embed = new EmbedBuilder()
      .setColor("#43B581")
      .setTitle("🌾 Grow A Garden — Tracker")
      .addFields(
        { name: "🛠️ Gear", value: gearList, inline: true },
        { name: "🌱 Seeds", value: seedList, inline: true },
        { name: "🥚 Eggs", value: eggList, inline: true },
        { name: "🎨 Cosmetics", value: cosmeticsList + `\n⏳ Restock in: ${cosmeticsRestock}`, inline: false },
        { name: "🍯 Honey Stock", value: honeyList + `\n⏳ Restock in: ${honeyRestock}`, inline: false },
        { name: "🌤️ Weather", value: `${weatherIcon} ${weatherCurrent}`, inline: true },
        { name: "🪴 Crop Bonus", value: cropBonus, inline: true },
        { name: "⏳ Restocks", value: `• Gear/Seed: ${gearRestock}\n• Egg: ${eggRestock}`, inline: false },
      )
      .setFooter({ text: footerText })
      .setTimestamp();

    return embed;
  } catch (err) {
    console.error("Error fetching stock data:", err);
    return new EmbedBuilder()
      .setColor("#ED4245")
      .setTitle("❌ Error")
      .setDescription("Failed to fetch Grow A Garden stock data. Please try again later.")
      .setFooter({ text: footerText });
  }
}

function startTracking(userId) {
  if (activeSessions.has(userId)) return;
  
  const interval = setInterval(async () => {
    try {
      const user = await client.users.fetch(userId);
      if (!user) {
        clearInterval(interval);
        activeSessions.delete(userId);
        return;
      }
      const embed = await createStockEmbed();
      await user.send({ embeds: [embed] });
    } catch (err) {
      console.error(`Failed to send update to user ${userId}:`, err);
    }
  }, fetchIntervalMs);

  activeSessions.set(userId, interval);
}

function stopTracking(userId) {
  if (!activeSessions.has(userId)) return;
  clearInterval(activeSessions.get(userId));
  activeSessions.delete(userId);
}

client.once("ready", async () => {
  console.log(`Logged in as ${client.user.tag}!`);
  loadRegisteredUsers();
  await registerCommands();
});

client.on("interactionCreate", async (interaction) => {
  if (!interaction.isCommand()) return;

  const { commandName, user } = interaction;

  if (commandName === "register") {
    if (registeredUsers.has(user.id)) {
      await interaction.reply({
        embeds: [
          new EmbedBuilder()
            .setColor("#FEE75C")
            .setTitle("⚠️ Already Registered")
            .setDescription("You are already registered!")
            .setFooter({ text: footerText }),
        ],
        ephemeral: true,
      });
      return;
    }

    registeredUsers.add(user.id);
    saveRegisteredUsers();

    await interaction.reply({
      embeds: [
        new EmbedBuilder()
          .setColor("#57F287")
          .setTitle("✅ Registration Successful!")
          .setDescription(`Hi **${user.username}**, you are now registered to use the Grow A Garden tracker bot.`)
          .setFooter({ text: footerText }),
      ],
      ephemeral: true,
    });
  } else if (commandName === "track") {
    if (!registeredUsers.has(user.id)) {
      await interaction.reply({
        embeds: [
          new EmbedBuilder()
            .setColor("#ED4245")
            .setTitle("⚠️ Not Registered")
            .setDescription("You need to register first to use this bot. Use `/register`.")
            .setFooter({ text: footerText }),
        ],
        ephemeral: true,
      });
      return;
    }

    if (activeSessions.has(user.id)) {
      await interaction.reply({
        embeds: [
          new EmbedBuilder()
            .setColor("#FEE75C")
            .setTitle("⚠️ Already Tracking")
            .setDescription("You are already receiving updates. Use `/stop` to stop.")
            .setFooter({ text: footerText }),
        ],
        ephemeral: true,
      });
      return;
    }

    await interaction.reply({
      embeds: [
        new EmbedBuilder()
          .setColor("#57F287")
          .setTitle("📡 Tracking Started")
          .setDescription("You'll receive Grow A Garden stock updates every 10 seconds via DM.")
          .setFooter({ text: footerText }),
      ],
      ephemeral: true,
    });

    startTracking(user.id);
  } else if (commandName === "stop") {
    if (!activeSessions.has(user.id)) {
      await interaction.reply({
        embeds: [
          new EmbedBuilder()
            .setColor("#FEE75C")
            .setTitle("⚠️ Not Tracking")
            .setDescription("You are not currently receiving updates.")
            .setFooter({ text: footerText }),
        ],
        ephemeral: true,
      });
      return;
    }

    stopTracking(user.id);

    await interaction.reply({
      embeds: [
        new EmbedBuilder()
          .setColor("#ED4245")
          .setTitle("🛑 Tracking Stopped")
          .setDescription("You will no longer receive Grow A Garden stock updates.")
          .setFooter({ text: footerText }),
      ],
      ephemeral: true,
    });
  }
});

client.login(botToken);
