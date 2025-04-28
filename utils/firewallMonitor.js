const { exec } = require("child_process");
const util = require("util");
const execPromise = util.promisify(exec);

/**
 * Get the status of iptables firewall
 * @returns {Promise<Object>} Firewall status information
 */
async function getFirewallStatus() {
  try {
    // Check if we can run iptables
    try {
      await execPromise("which iptables");
    } catch (error) {
      return {
        success: false,
        error: "iptables is not available on this system",
      };
    }

    // Get iptables rules with statistics
    const [inputRules, outputRules, forwardRules] = await Promise.all([
      execPromise("iptables -L INPUT -v -n"),
      execPromise("iptables -L OUTPUT -v -n"),
      execPromise("iptables -L FORWARD -v -n"),
    ]);

    // Parse chain policies
    const inputPolicy = parseChainPolicy(inputRules.stdout);
    const outputPolicy = parseChainPolicy(outputRules.stdout);
    const forwardPolicy = parseChainPolicy(forwardRules.stdout);

    // Parse rules
    const parsedInputRules = parseRules(inputRules.stdout);
    const parsedOutputRules = parseRules(outputRules.stdout);
    const parsedForwardRules = parseRules(forwardRules.stdout);

    // Calculate statistics
    const inputStats = calculateChainStats(parsedInputRules);
    const outputStats = calculateChainStats(parsedOutputRules);
    const forwardStats = calculateChainStats(parsedForwardRules);

    // Check if UFW is active (if available)
    let ufwStatus = null;
    try {
      const { stdout: ufwOutput } = await execPromise("ufw status");
      ufwStatus = {
        active: !ufwOutput.includes("inactive"),
        status: ufwOutput.trim(),
      };
    } catch (error) {
      // UFW is not installed, ignore
    }

    // Check if firewalld is active (if available)
    let firewalldStatus = null;
    try {
      const { stdout: firewalldOutput } = await execPromise(
        "firewall-cmd --state"
      );
      firewalldStatus = {
        active: firewalldOutput.trim() === "running",
        status: firewalldOutput.trim(),
      };
    } catch (error) {
      // firewalld is not installed, ignore
    }

    return {
      success: true,
      iptables: {
        input: {
          policy: inputPolicy,
          rules: parsedInputRules,
          stats: inputStats,
        },
        output: {
          policy: outputPolicy,
          rules: parsedOutputRules,
          stats: outputStats,
        },
        forward: {
          policy: forwardPolicy,
          rules: parsedForwardRules,
          stats: forwardStats,
        },
      },
      ufw: ufwStatus,
      firewalld: firewalldStatus,
    };
  } catch (error) {
    console.error("Error getting firewall status:", error);
    return {
      success: false,
      error: error.message,
    };
  }
}

/**
 * Parse the chain policy from iptables output
 * @param {string} output - iptables command output
 * @returns {string} Chain policy (ACCEPT, DROP, etc.)
 */
function parseChainPolicy(output) {
  const policyMatch = output.match(/Chain\s+\w+\s+\(policy\s+(\w+)/);
  return policyMatch ? policyMatch[1] : "UNKNOWN";
}

/**
 * Parse iptables rules from command output
 * @param {string} output - iptables command output
 * @returns {Array} Parsed rules
 */
function parseRules(output) {
  const lines = output.split("\n");
  const rules = [];

  // Skip the first two lines (header and column names)
  for (let i = 2; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;

    const fields = line.split(/\s+/);
    if (fields.length < 8) continue;

    const packets = parseInt(fields[0], 10) || 0;
    const bytes = parseInt(fields[1], 10) || 0;
    const target = fields[2];
    const prot = fields[3];
    const opt = fields[4];
    const source = fields[5];
    const destination = fields[6];

    // Combine the rest of the fields as 'extra'
    const extra = fields.slice(7).join(" ");

    rules.push({
      packets,
      bytes,
      target,
      protocol: prot,
      options: opt,
      source,
      destination,
      extra,
    });
  }

  return rules;
}

/**
 * Calculate statistics for a chain
 * @param {Array} rules - Parsed rules
 * @returns {Object} Statistics for the chain
 */
function calculateChainStats(rules) {
  const stats = {
    totalPackets: 0,
    totalBytes: 0,
    byTarget: {},
  };

  rules.forEach((rule) => {
    stats.totalPackets += rule.packets;
    stats.totalBytes += rule.bytes;

    if (!stats.byTarget[rule.target]) {
      stats.byTarget[rule.target] = {
        packets: 0,
        bytes: 0,
        count: 0,
      };
    }

    stats.byTarget[rule.target].packets += rule.packets;
    stats.byTarget[rule.target].bytes += rule.bytes;
    stats.byTarget[rule.target].count += 1;
  });

  // Format bytes to be human-readable
  stats.totalBytesFormatted = formatBytes(stats.totalBytes);
  Object.keys(stats.byTarget).forEach((target) => {
    stats.byTarget[target].bytesFormatted = formatBytes(
      stats.byTarget[target].bytes
    );
  });

  return stats;
}

/**
 * Block an IP address using iptables
 * @param {string} ip - IP address to block
 * @returns {Promise<Object>} Result of the operation
 */
async function blockIP(ip) {
  try {
    // Validate IP address
    if (!isValidIP(ip)) {
      return {
        success: false,
        error: "Invalid IP address format",
      };
    }

    // Check if the IP is already blocked
    const { stdout } = await execPromise(
      `iptables -C INPUT -s ${ip} -j DROP 2>/dev/null || echo "not_found"`
    );

    if (!stdout.includes("not_found")) {
      return {
        success: false,
        error: `IP address ${ip} is already blocked`,
      };
    }

    // Block the IP
    await execPromise(`iptables -A INPUT -s ${ip} -j DROP`);

    // Add to output chain too for completeness
    await execPromise(`iptables -A OUTPUT -d ${ip} -j DROP`);

    // Save the rules to make them persistent (different methods based on distro)
    try {
      // Try with iptables-save first (Debian/Ubuntu)
      await execPromise("iptables-save > /etc/iptables/rules.v4");
    } catch (error) {
      try {
        // Try with CentOS/RHEL method
        await execPromise("service iptables save");
      } catch (innerError) {
        console.warn(
          "Could not make iptables rules persistent:",
          innerError.message
        );
      }
    }

    return {
      success: true,
      message: `Successfully blocked IP address ${ip}`,
      ip,
    };
  } catch (error) {
    console.error(`Error blocking IP ${ip}:`, error);
    return {
      success: false,
      error: error.message,
    };
  }
}

/**
 * Unblock an IP address using iptables
 * @param {string} ip - IP address to unblock
 * @returns {Promise<Object>} Result of the operation
 */
async function unblockIP(ip) {
  try {
    // Validate IP address
    if (!isValidIP(ip)) {
      return {
        success: false,
        error: "Invalid IP address format",
      };
    }

    // Check if the IP is blocked in INPUT chain
    const inputCheck = await execPromise(
      `iptables -C INPUT -s ${ip} -j DROP 2>/dev/null || echo "not_found"`
    );
    const inputBlocked = !inputCheck.stdout.includes("not_found");

    // Check if the IP is blocked in OUTPUT chain
    const outputCheck = await execPromise(
      `iptables -C OUTPUT -d ${ip} -j DROP 2>/dev/null || echo "not_found"`
    );
    const outputBlocked = !outputCheck.stdout.includes("not_found");

    if (!inputBlocked && !outputBlocked) {
      return {
        success: false,
        error: `IP address ${ip} is not blocked`,
      };
    }

    // Remove the rules
    if (inputBlocked) {
      await execPromise(`iptables -D INPUT -s ${ip} -j DROP`);
    }

    if (outputBlocked) {
      await execPromise(`iptables -D OUTPUT -d ${ip} -j DROP`);
    }

    // Save the rules to make them persistent (different methods based on distro)
    try {
      // Try with iptables-save first (Debian/Ubuntu)
      await execPromise("iptables-save > /etc/iptables/rules.v4");
    } catch (error) {
      try {
        // Try with CentOS/RHEL method
        await execPromise("service iptables save");
      } catch (innerError) {
        console.warn(
          "Could not make iptables rules persistent:",
          innerError.message
        );
      }
    }

    return {
      success: true,
      message: `Successfully unblocked IP address ${ip}`,
      ip,
    };
  } catch (error) {
    console.error(`Error unblocking IP ${ip}:`, error);
    return {
      success: false,
      error: error.message,
    };
  }
}

/**
 * Validate IP address format
 * @param {string} ip - IP address to validate
 * @returns {boolean} True if valid, false otherwise
 */
function isValidIP(ip) {
  // IPv4 validation
  const ipv4Pattern = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;
  const ipv4Match = ip.match(ipv4Pattern);

  if (ipv4Match) {
    for (let i = 1; i <= 4; i++) {
      if (parseInt(ipv4Match[i], 10) > 255) {
        return false;
      }
    }
    return true;
  }

  // IPv6 validation (simple check)
  const ipv6Pattern =
    /^([0-9a-fA-F]{1,4}:){7}[0-9a-fA-F]{1,4}$|^::$|^::1$|^([0-9a-fA-F]{1,4}:){1,7}:$|^:([0-9a-fA-F]{1,4}:){1,7}$|^([0-9a-fA-F]{1,4}:){1,6}:[0-9a-fA-F]{1,4}$|^([0-9a-fA-F]{1,4}:){1,5}(:[0-9a-fA-F]{1,4}){1,2}$|^([0-9a-fA-F]{1,4}:){1,4}(:[0-9a-fA-F]{1,4}){1,3}$|^([0-9a-fA-F]{1,4}:){1,3}(:[0-9a-fA-F]{1,4}){1,4}$|^([0-9a-fA-F]{1,4}:){1,2}(:[0-9a-fA-F]{1,4}){1,5}$|^[0-9a-fA-F]{1,4}:((:[0-9a-fA-F]{1,4}){1,6})$|^:(:[0-9a-fA-F]{1,4}){1,7}$|^fe80:(:[0-9a-fA-F]{0,4}){0,4}%[0-9a-zA-Z]{1,}$|^::(ffff(:0{1,4}){0,1}:){0,1}((25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9])\.){3,3}(25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9])$|^([0-9a-fA-F]{1,4}:){1,4}:((25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9])\.){3,3}(25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9])$/;

  return ipv6Pattern.test(ip);
}

/**
 * Format bytes to human-readable format
 * @param {number} bytes - Number of bytes
 * @returns {string} Formatted size
 */
function formatBytes(bytes) {
  if (bytes === 0) return "0 B";

  const sizes = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));

  return parseFloat((bytes / Math.pow(1024, i)).toFixed(2)) + " " + sizes[i];
}

/**
 * Get detailed firewall rules output
 * @returns {Promise<Object>} Detailed firewall rules output
 */
async function getDetailedRules() {
  try {
    // Check if we can run iptables
    try {
      await execPromise("which iptables");
    } catch (error) {
      return {
        success: false,
        error: "iptables is not available on this system",
      };
    }

    // Get raw iptables output in different formats
    const [saveRules, listRules] = await Promise.all([
      execPromise("iptables-save"),
      execPromise("iptables -L -v -n"),
    ]);

    return {
      success: true,
      rules: {
        saveFormat: saveRules.stdout,
        listFormat: listRules.stdout,
      },
    };
  } catch (error) {
    console.error("Error getting detailed firewall rules:", error);
    return {
      success: false,
      error: error.message,
    };
  }
}

module.exports = {
  getFirewallStatus,
  blockIP,
  unblockIP,
  getDetailedRules,
};
