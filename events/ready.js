module.exports = {
  name: "ready",
  once: true,
  execute(client) {
    console.log(`Ready! Logged in as ${client.user.tag}`);

    // Set the bot's activity
    client.user.setActivity("VPS Monitoring", { type: "WATCHING" });

    console.log(`Loaded ${client.commands.size} commands`);
  },
};
