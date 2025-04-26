# Discord VPS Monitoring Bot

A Discord bot for monitoring your VPS and Docker containers using slash commands.

## Features

- System monitoring (CPU, memory, disk, network)
- Process monitoring
- Docker monitoring (system info, containers, images)
- Docker container management (start, stop, restart)
- Container logs viewer
- All features accessible via slash commands
- Interactive UI with buttons
- Real-time data refreshing

## Prerequisites

- Node.js v16.9.0 or higher
- Discord.js v14
- A Discord bot token
- Docker running on the VPS

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
   GUILD_ID=your_discord_guild_id_here
   ```

4. Deploy slash commands:
   ```
   node deploy-commands.js
   ```

5. Start the bot:
   ```
   node index.js
   ```

## Usage

The bot provides the following slash commands:

### System Monitoring

- `/system info` - Show basic system information (CPU, memory, disk usage)
- `/system network` - Show network information and statistics
- `/system processes` - Show top CPU-consuming processes

### Docker Monitoring

- `/docker info` - Show Docker system information
- `/docker containers` - List all Docker containers
- `/docker details <container>` - Show detailed information about a specific container
- `/docker logs <container>` - Show container logs
- `/docker control <container> <action>` - Control a container (start, stop, restart)

## Automating Bot Startup

To make sure the bot starts automatically on system reboot, you can use systemd (Linux) or Windows Task Scheduler.

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

## License

MIT 