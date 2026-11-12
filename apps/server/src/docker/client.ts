import Docker from "dockerode";

/** Uses /var/run/docker.sock (or DOCKER_HOST when set). */
export const docker = new Docker();
