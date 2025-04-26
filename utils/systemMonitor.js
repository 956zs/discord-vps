const si = require("systeminformation");
const { exec } = require("child_process");
const util = require("util");
const execPromise = util.promisify(exec);

/**
 * Get uptime information using system command
 * @returns {Promise<Object>} Uptime information
 */
async function getUptimeInfo() {
  try {
    // 使用系統的uptime命令獲取運行時間
    const { stdout } = await execPromise("uptime");

    // 解析uptime輸出
    // 典型輸出格式: 18:09:18 up 3 days, 4:31, 16 users, load average: 0.12, 0.04, 0.01
    const uptimeMatch = stdout.match(
      /up\s+(?:(\d+)\s+days?,\s+)?(?:(\d+):)?(\d+)/
    );

    if (uptimeMatch) {
      const days = uptimeMatch[1] ? parseInt(uptimeMatch[1]) : 0;
      const hours = uptimeMatch[2] ? parseInt(uptimeMatch[2]) : 0;
      const minutes = parseInt(uptimeMatch[3]);

      return {
        days,
        hours,
        minutes,
        raw: stdout.trim(),
      };
    } else {
      // 如果無法解析，則使用systeminformation的結果作為後備
      const os = await si.osInfo();
      return {
        days: Math.floor(os.uptime / 86400),
        hours: Math.floor((os.uptime % 86400) / 3600),
        minutes: Math.floor((os.uptime % 3600) / 60),
        raw: `Fallback: ${os.uptime} seconds`,
      };
    }
  } catch (error) {
    console.error("Error getting uptime:", error);
    // 錯誤時使用systeminformation的結果作為後備
    const os = await si.osInfo();
    return {
      days: Math.floor(os.uptime / 86400),
      hours: Math.floor((os.uptime % 86400) / 3600),
      minutes: Math.floor((os.uptime % 3600) / 60),
      raw: `Error: ${error.message}, using fallback`,
    };
  }
}

/**
 * Get basic system information
 * @returns {Promise<Object>} System information including CPU, memory, OS, and uptime
 */
async function getSystemInfo() {
  try {
    const [cpu, mem, os, time, fsSize, currentLoad, uptimeInfo] =
      await Promise.all([
        si.cpu(),
        si.mem(),
        si.osInfo(),
        si.time(),
        si.fsSize(),
        si.currentLoad(),
        getUptimeInfo(),
      ]);

    const memoryInfo = {
      total: (mem.total / 1073741824).toFixed(2),
      used: (mem.used / 1073741824).toFixed(2),
      free: (mem.free / 1073741824).toFixed(2),
      usedPercentage: ((mem.used / mem.total) * 100).toFixed(2),
    };

    const diskInfo = fsSize.map((disk) => ({
      fs: disk.fs,
      type: disk.type,
      size: (disk.size / 1073741824).toFixed(2),
      used: (disk.used / 1073741824).toFixed(2),
      available: (disk.available / 1073741824).toFixed(2),
      usedPercentage: disk.use.toFixed(2),
    }));

    return {
      cpu: {
        manufacturer: cpu.manufacturer,
        brand: cpu.brand,
        cores: cpu.cores,
        speed: cpu.speed,
        usage: currentLoad.currentLoad.toFixed(2),
      },
      memory: memoryInfo,
      os: {
        platform: os.platform,
        distro: os.distro,
        release: os.release,
        kernel: os.kernel,
        arch: os.arch,
      },
      uptime: uptimeInfo,
      disks: diskInfo,
      time: time,
    };
  } catch (error) {
    console.error("Error getting system information:", error);
    throw error;
  }
}

/**
 * Get network information
 * @returns {Promise<Object>} Network information including interfaces and stats
 */
async function getNetworkInfo() {
  try {
    const [networkInterfaces, networkStats] = await Promise.all([
      si.networkInterfaces(),
      si.networkStats(),
    ]);

    return {
      interfaces: networkInterfaces.map((iface) => ({
        name: iface.iface,
        ip4: iface.ip4,
        ip6: iface.ip6,
        mac: iface.mac,
        type: iface.type,
        speed: iface.speed,
        operstate: iface.operstate,
      })),
      stats: networkStats.map((stat) => ({
        interface: stat.iface,
        rx_bytes: (stat.rx_bytes / 1024 / 1024).toFixed(2),
        tx_bytes: (stat.tx_bytes / 1024 / 1024).toFixed(2),
        rx_sec: stat.rx_sec ? (stat.rx_sec / 1024).toFixed(2) : 0,
        tx_sec: stat.tx_sec ? (stat.tx_sec / 1024).toFixed(2) : 0,
      })),
    };
  } catch (error) {
    console.error("Error getting network information:", error);
    throw error;
  }
}

/**
 * Get process information
 * @returns {Promise<Array>} List of top processes by CPU usage
 */
async function getProcessInfo() {
  try {
    const processes = await si.processes();

    // Sort by CPU usage and get top 10
    const topProcesses = processes.list
      .sort((a, b) => b.cpu - a.cpu)
      .slice(0, 10)
      .map((proc) => ({
        pid: proc.pid,
        name: proc.name,
        cpu: proc.cpu.toFixed(2),
        mem: proc.mem.toFixed(2),
        memUsed: (proc.memRss / 1024 / 1024).toFixed(2),
        started: proc.started,
      }));

    return topProcesses;
  } catch (error) {
    console.error("Error getting process information:", error);
    throw error;
  }
}

module.exports = {
  getSystemInfo,
  getNetworkInfo,
  getProcessInfo,
};
