const path = require('node:path');
const fs = require('node:fs');

/**
 * PATHS & BINARY DISCOVERY UTILITY
 * Centralizes the logic for finding the REPO_ROOT and key executables.
 */

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const STORAGE_DATA_DIR = path.join(REPO_ROOT, 'storage', 'data');
const API_CACHE_DIR = path.join(STORAGE_DATA_DIR, 'cache', 'api_responses');

const BINARY_NAME = process.platform === 'win32' ? 'sovereign_wealth.exe' : 'sovereign_wealth';

const BACKEND_CANDIDATES = [
    path.join(REPO_ROOT, 'build', 'backend', 'core', 'Release', BINARY_NAME),
    path.join(REPO_ROOT, 'build', 'backend', 'core', 'Debug', BINARY_NAME),
    path.join(REPO_ROOT, 'backend', 'core', 'build', 'manual', BINARY_NAME),
    path.join(REPO_ROOT, 'build', 'backend', 'core', BINARY_NAME),
    path.join(REPO_ROOT, 'backend', 'core', 'src', BINARY_NAME),
];

const CLI_CANDIDATES = [
    path.join(REPO_ROOT, 'backend', 'cli', 'sovereign_cli.js'),
];

/**
 * Finds the C++ backend binary.
 * Priority: Env var > Candidates list
 */
function findBackendBinary() {
    if (process.env.SOVEREIGN_BACKEND_BIN && fs.existsSync(process.env.SOVEREIGN_BACKEND_BIN)) {
        return process.env.SOVEREIGN_BACKEND_BIN;
    }
    return BACKEND_CANDIDATES.find(c => fs.existsSync(c)) || null;
}

/**
 * Finds the Node CLI entrypoint.
 */
function findNodeCli() {
    return CLI_CANDIDATES.find(c => fs.existsSync(c)) || null;
}

/**
 * Loads tool configurations from config/tools.yaml.
 * Uses a basic regex-based parser to avoid external dependencies in shared lib.
 */
function loadToolsConfig() {
    const toolsPath = path.join(REPO_ROOT, 'config', 'system', 'tools.yaml');
    if (!fs.existsSync(toolsPath)) return {};
    
    const content = fs.readFileSync(toolsPath, 'utf8');
    const config = {};
    let currentKey = null;

    content.split('\n').forEach(line => {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) return;

        // Header key (e.g., "msys64:")
        if (line.match(/^[a-z0-9_]+:/i)) {
            currentKey = trimmed.replace(':', '');
            config[currentKey] = {};
        } 
        // Sub-key or list (very basic parsing)
        else if (currentKey && trimmed.startsWith('-')) {
            const val = trimmed.replace(/^- /, '').replace(/"/g, '').replace(/'/g, '');
            const listKey = 'candidates'; // Default list key
            if (!config[currentKey][listKey]) config[currentKey][listKey] = [];
            config[currentKey][listKey].push(val);
        }
        else if (currentKey && trimmed.includes(':')) {
            const [k, v] = trimmed.split(':').map(s => s.trim());
            config[currentKey][k] = v.replace(/"/g, '').replace(/'/g, '');
        }
    });

    return config;
}

/**
 * Finds an external tool by checking candidates in config or environment.
 */
function findTool(toolName, envVar) {
    if (envVar && process.env[envVar] && fs.existsSync(process.env[envVar])) {
        return process.env[envVar];
    }

    const config = loadToolsConfig();
    const toolSpec = config[toolName];
    if (toolSpec) {
        // Check all candidate lists/properties
        for (const list of Object.values(toolSpec)) {
            if (Array.isArray(list)) {
                const found = list.find(c => fs.existsSync(c) || (!c.includes('\\') && !c.includes('/') && which(c)));
                if (found) return found;
            } else if (typeof list === 'string' && fs.existsSync(list)) {
                return list;
            }
        }
    }
    return null;
}

/**
 * Simple 'which' check for system paths
 */
function which(cmd) {
    try {
        const { execSync } = require('node:child_process');
        const checkCmd = process.platform === 'win32' ? `where ${cmd}` : `which ${cmd}`;
        execSync(checkCmd, { stdio: 'ignore' });
        return cmd;
    } catch {
        return null;
    }
}

// Canonical storage path constants — import these; never recompute them per-file.
const DEFAULT_SNAPSHOT      = path.join(STORAGE_DATA_DIR, 'cache', 'last_fetch.json');
const DEFAULT_QUALITY_REPORT = path.join(STORAGE_DATA_DIR, 'cache', 'data_quality_report.json');
const DEFAULT_FEATURES      = path.join(STORAGE_DATA_DIR, 'features', 'latest_features.json');
const DEFAULT_MODEL_REPORT  = path.join(STORAGE_DATA_DIR, 'models', 'latest_model_comparison.json');
const DEFAULT_BACKTEST      = path.join(STORAGE_DATA_DIR, 'backtests', 'latest_backtest.json');
const DEFAULT_STATE_PATH    = path.join(REPO_ROOT, 'workspace', 'STATE.md');

module.exports = {
    REPO_ROOT,
    STORAGE_DATA_DIR,
    API_CACHE_DIR,
    DEFAULT_SNAPSHOT,
    DEFAULT_QUALITY_REPORT,
    DEFAULT_FEATURES,
    DEFAULT_MODEL_REPORT,
    DEFAULT_BACKTEST,
    DEFAULT_STATE_PATH,
    findBackendBinary,
    findNodeCli,
    findTool,
    BACKEND_CANDIDATES,
    CLI_CANDIDATES
};
