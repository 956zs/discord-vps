# Discord VPS Monitoring Bot

A Discord bot for monitoring and managing your VPS and Docker containers using slash commands and interactive components.

<img src="https://img.shields.io/badge/Discord-Bot-5865F2?style=for-the-badge&logo=discord&logoColor=white" alt="Discord Bot">
<img src="https://img.shields.io/badge/Docker-Ready-2496ED?style=for-the-badge&logo=docker&logoColor=white" alt="Docker Ready">
<img src="https://img.shields.io/badge/Node.js-16+-339933?style=for-the-badge&logo=node.js&logoColor=white" alt="Node.js 16+">

## Features

### System Monitoring
- **System Information**: CPU, memory, disk usage and uptime
- **Network Monitoring**: Interface details and traffic statistics
- **Process Monitoring**: View top CPU-consuming processes

### Docker Management
- **Docker System Information**: Version, resource usage, container counts
- **Container Listing**: View all containers with their statuses
- **Detailed Container Views**: Stats, ports, mounts, and more
- **Container Controls**: Start, stop, restart with confirmation dialogs
- **Container Logs**: View and refresh container logs
- **Interactive Selection**: Dropdown menus for easy container selection

### Terminal Commands
- **Single Command Execution**: Run individual commands and view outputs
- **Interactive Terminal Sessions**: Start a terminal session and execute multiple commands
- **Working Directory Handling**: Change directories and maintain session state
- **Command History**: View command execution history within sessions

### User Experience
- **Interactive UI**: Buttons, dropdowns, and confirmation dialogs
- **Real-time Updates**: Refresh data with a single click
- **Safety Confirmations**: Prevent accidental container stops/restarts
- **Autocomplete**: Command options with autocomplete for container names
- **Comprehensive Help**: Built-in help system for all commands

## Prerequisites

- Node.js v16.9.0 or higher
- Discord.js v14
- A Discord bot token with proper intents
- Docker running on the VPS (for Docker features)

## Installation

1. Clone this repository to your VPS:
   ```
   git clone https://github.com/yourusername/discord-vps.git
   cd discord-vps
   ```

2. Install dependencies:
   ```
   npm install
   ```

3. Create a `.env` file in the root directory with the following content:
   ```
   DISCORD_TOKEN=your_discord_bot_token_here
   CLIENT_ID=your_discord_client_id_here
   ```

4. Deploy slash commands:
   ```
   node deploy-commands.js
   ```

5. Start the bot:
   ```
   node index.js
   ```

## Commands

### System Commands

- **`/system info`** - Show system information
  - View CPU, memory, disk usage, and uptime
  - Click "Refresh" to update the information

- **`/system network`** - Show network information
  - View all network interfaces, IP addresses, and traffic statistics
  - Monitor real-time network usage

- **`/system processes`** - Show top CPU-consuming processes
  - View current running processes sorted by CPU usage
  - See memory consumption and process details

### Docker Commands

- **`/docker info`** - Show Docker system information
  - View Docker version, resource usage, and container counts
  - Click "Docker Containers" to navigate to container list

- **`/docker containers [all]`** - List Docker containers
  - View all containers grouped by state (running, stopped, other)
  - Select containers from dropdown for quick access
  - Optional `all` parameter to show/hide stopped containers

- **`/docker details <container>`** - Show container details
  - View detailed information about a specific container
  - Container stats, network, mounts, and configuration
  - Control buttons for managing the container

- **`/docker logs <container> [lines]`** - Show container logs
  - View recent logs from a container
  - Specify how many lines to display
  - Click "Refresh" to get the latest logs

- **`/docker control <container> <action>`** - Control a container
  - Actions: start, stop, restart
  - Confirmation dialog for potentially disruptive actions
  - Automatic status updates after action completion

### Terminal Commands

- **`/terminal run <command>`** - Run a single terminal command
  - Execute a command and view its output
  - Click "Rerun" to execute the command again

- **`/terminal session`** - Start an interactive terminal session
  - Type commands directly in the channel
  - Maintain working directory state between commands
  - Use `cd` to navigate between directories
  - Command history is tracked and displayed
  - Type `debug-dir` to troubleshoot directory issues

### Help System

- **`/help`** - Show general help information
  - Overview of all available command categories
  - Basic usage tips and guidance
  
- **`/help [command]`** - Show detailed help for a specific command
  - Choose from dropdown menu: `system`, `docker`
  - View detailed descriptions and parameter information
  - Learn command-specific features and tips

## Security Considerations

- The bot requires proper Discord permissions and intents
- Required intents include `GUILDS`, `GUILD_MESSAGES`, and `MESSAGE_CONTENT`
- Docker management capabilities give significant control over your server
- Consider restricting the bot to specific channels or users

## Automating Bot Startup

### Using systemd (Linux)

1. Create a systemd service file:
   ```
   sudo nano /etc/systemd/system/discord-vps.service
   ```

2. Add the following content:
   ```
   [Unit]
   Description=Discord VPS Monitoring Bot
   After=network.target

   [Service]
   User=yourusername
   WorkingDirectory=/path/to/discord-vps
   ExecStart=/usr/bin/node index.js
   Restart=on-failure
   RestartSec=10
   StandardOutput=syslog
   StandardError=syslog
   SyslogIdentifier=discord-vps

   [Install]
   WantedBy=multi-user.target
   ```

3. Enable and start the service:
   ```
   sudo systemctl enable discord-vps
   sudo systemctl start discord-vps
   ```

### Using PM2 (Cross-platform)

1. Install PM2 globally:
   ```
   npm install -g pm2
   ```

2. Start the bot with PM2:
   ```
   pm2 start index.js --name discord-vps
   ```

3. Set PM2 to start on boot:
   ```
   pm2 startup
   pm2 save
   ```

## Troubleshooting

### Terminal Session Issues
- If directory navigation doesn't work, use the `debug-dir` command
- Ensure the bot has proper permissions to execute commands
- Check that the MESSAGE_CONTENT intent is enabled for your bot

### Docker Connection Issues
- Ensure Docker is running on your system
- The bot user may need to be added to the docker group: `sudo usermod -aG docker $USER`
- You may need to adjust socket permissions: `sudo chmod 666 /var/run/docker.sock`

## License

MIT 