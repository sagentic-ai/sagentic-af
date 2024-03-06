import * as fs from "fs";
import * as child_process from "child_process";
import depcheck from "depcheck";

// lock deps with given command
async function lock(command: string, path: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = child_process.exec(
      command,
      { cwd: path },
      (error, stdout, stderr) => {
        if (error) {
          reject(error);
        } else {
          resolve();
        }
      }
    );
  });
}

// try to lock dependencies with pnpm
async function lockPnpm(path: string, debug: boolean): Promise<string> {
  try {
    const cmd = `pnpm install --prod --loglevel=error --lockfile-only`;
    await lock(cmd, path);
    return "pnpm-lock.yaml";
  } catch (e: any) {
    if (debug) {
      console.log("Failed to lock dependencies with pnpm", e);
    }
    return "";
  }
}

// try to lock dependencies with npm
async function lockNpm(path: string, debug: boolean): Promise<string> {
  try {
    const cmd = `npm install --only=production --loglevel=error --no-audit --no-fund --package-lock-only --omit dev`;
    await lock(cmd, path);
    return "package-lock.json";
  } catch (e: any) {
    if (debug) {
      console.log("Failed to lock dependencies with npm", e);
    }
    return "";
  }
}

// try locking dependencies with pnpm or npm, returning the lockfile path
export async function lockDeps(
  path: string,
  packageManager: string,
  debug: boolean
): Promise<string> {
  let pm = "";
  let lockfile = "";
  let pms = ["pnpm", "npm", "none"];
  if (packageManager) {
    pms = [packageManager];
  }

  console.log("Locking dependencies...");
  for (const p of pms) {
    switch (p) {
      case "pnpm":
        lockfile = await lockPnpm(path, debug);
        break;
      case "npm":
        lockfile = await lockNpm(path, debug);
        break;
      case "none":
        lockfile = "";
        break;
      default:
        throw new Error(`Unknown package manager: ${p}`);
    }
    if (lockfile) {
      pm = p;
      break;
    }
  }

  if (lockfile) {
    console.log(`Locked dependencies with ${pm} at ${path}/${lockfile}`);
  }
  if (pm !== "pnpm") {
    console.log(`Consider using pnpm for faster agent spawn times`);
  }

  return lockfile;
}

// return local dependencies from package.json
export function getLocalDeps(packageJson: any, debug: boolean): string[] {
  const localDeps = [];
  for (const key in packageJson.dependencies) {
    if (packageJson.dependencies[key].startsWith("file:")) {
      localDeps.push(key);
    }
  }
  return localDeps;
}

// check if all used dependencies are declared in package.json
export async function checkDeps(
  path: string,
  debug: boolean
): Promise<string[]> {
  try {
    const missingDeps = [];
    const options = {
      ignoreBinPackage: false,
      ignoreMatches: [
        "eslint",
        "eslint-config-prettier",
        "eslint-plugin-prettier",
        "prettier",
        "husky",
        "lint-staged",
        "typescript",
      ],
    };
    const result = await depcheck(path, options);
    for (const key in result.missing) {
      missingDeps.push(key);
    }
    return missingDeps;
  } catch (e) {
    if (debug) {
      console.log("Failed to check dependencies", e);
    }
    return [];
  }
}
