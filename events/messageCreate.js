/**
 * messageCreate.js - Handles incoming Discord messages
 *
 * Primary purpose is to process terminal commands for active terminal sessions
 */

module.exports = {
  name: "messageCreate",
  async execute(message, client) {
    // Ignore bot messages
    if (message.author.bot) return;

    // Get the terminal command module
    const terminalCommand = client.commands.get("terminal");

    // If the terminal command module exists and has a message handler, process the message
    if (terminalCommand && terminalCommand.handleMessage) {
      await terminalCommand.handleMessage(message, client);
    }
  },
};
