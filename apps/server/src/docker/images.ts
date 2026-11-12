import { docker } from "./client";

export interface Credentials {
  username: string;
  password: string;
}

export interface RegistryAuth {
  username: string;
  password: string;
  serveraddress: string;
}

const DOCKER_HUB = "https://index.docker.io/v1/";

export function registryServerFor(imageRef: string): string {
  const slash = imageRef.indexOf("/");
  if (slash === -1) return DOCKER_HUB;
  const first = imageRef.slice(0, slash);
  if (first.includes(".") || first.includes(":") || first === "localhost") return first;
  return DOCKER_HUB;
}

export function authConfigFor(
  imageRef: string,
  credentials: Credentials | null,
): RegistryAuth | undefined {
  if (!credentials) return undefined;
  return {
    username: credentials.username,
    password: credentials.password,
    serveraddress: registryServerFor(imageRef),
  };
}

export async function pullImage(
  imageRef: string,
  credentials: Credentials | null,
  log: (line: string) => void,
): Promise<void> {
  log(`Pulling image ${imageRef}`);
  const authconfig = authConfigFor(imageRef, credentials);
  const stream = await docker.pull(imageRef, authconfig ? { authconfig } : {});
  let lastStatus = "";
  const { promise, resolve, reject } = Promise.withResolvers<void>();
  docker.modem.followProgress(
    stream,
    (error) => (error ? reject(error) : resolve()),
    (event: { status?: string; progress?: string; error?: string }) => {
      if (event.error) {
        log(`Pull error: ${event.error}`);
        return;
      }
      if (!event.status) return;
      const line = event.progress ? `${event.status} ${event.progress}` : event.status;
      if (line !== lastStatus) {
        lastStatus = line;
        log(line);
      }
    },
  );
  await promise;
  log(`Image ${imageRef} is ready.`);
}
