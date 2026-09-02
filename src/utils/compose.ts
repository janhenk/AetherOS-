import YAML from 'yaml';
import type { DockerCreateSpec } from '../types';

/** Ports must be quoted: a bare `8082:8080` is read as a base-60 number by YAML 1.1 parsers. */
function quoted(value: string): YAML.Scalar {
    const scalar = new YAML.Scalar(value);
    scalar.type = YAML.Scalar.QUOTE_DOUBLE;
    return scalar;
}

/**
 * Derives a compose service name from the container name (or, as a fallback,
 * from the image reference: `registry/foo/bar:tag` -> `bar`).
 */
export function composeServiceName(spec: DockerCreateSpec): string {
    const raw = spec.name?.trim()
        || spec.image?.split('@')[0].split(':')[0].split('/').pop()
        || 'service';
    const sanitized = raw.replace(/^\//, '').replace(/[^a-zA-Z0-9._-]/g, '-').replace(/^-+|-+$/g, '');
    return sanitized || 'service';
}

/**
 * Renders a DockerCreateSpec as a docker-compose file. Values are emitted via
 * the YAML serializer so anything containing `=`, `:` or spaces (connection
 * strings, for example) stays intact.
 */
export function specToCompose(spec: DockerCreateSpec): string {
    const service: Record<string, unknown> = { image: spec.image || '' };

    if (spec.name?.trim()) service.container_name = spec.name.trim().replace(/^\//, '');

    const ports = (spec.ports || []).filter(p => p.host || p.container);
    if (ports.length) ports.sort((a, b) => a.container.localeCompare(b.container, undefined, { numeric: true }));
    if (ports.length) service.ports = ports.map(p => quoted(`${p.host}:${p.container}`));

    const volumes = (spec.volumes || []).filter(v => v.host || v.container);
    if (volumes.length) volumes.sort((a, b) => a.container.localeCompare(b.container, undefined, { numeric: true }));
    if (volumes.length) service.volumes = volumes.map(v => quoted(`${v.host}:${v.container}`));

    const env = (spec.env || []).filter(e => e.key.trim());
    if (env.length) {
        env.sort((a, b) => a.key.localeCompare(b.key, undefined, { numeric: true, sensitivity: 'base' }));
        service.environment = Object.fromEntries(env.map(e => [e.key, e.value]));
    }

    // cpus / mem_limit work with `docker compose up` (deploy.resources is swarm-only)
    const cpus = spec.resources?.cpus?.trim();
    if (cpus && parseFloat(cpus) > 0) service.cpus = cpus;
    const memory = spec.resources?.memory?.trim();
    if (memory && parseFloat(memory) > 0) service.mem_limit = memory;

    // Network configuration
    const activeNetworks = (spec.networks || []).filter(n => Boolean(n?.trim()));
    const mode = spec.networkMode?.trim().toLowerCase();

    if (mode === 'host' || mode === 'none') {
        service.network_mode = mode;
    } else if (activeNetworks.length > 0) {
        if (activeNetworks.includes('host') || activeNetworks.includes('none')) {
            service.network_mode = activeNetworks.includes('host') ? 'host' : 'none';
        } else {
            service.networks = activeNetworks;
        }
    }

    const doc: Record<string, unknown> = {
        services: {
            [composeServiceName(spec)]: service
        }
    };

    // If custom networks are used (excluding default/bridge), declare them as external networks
    const customNetworks = activeNetworks.filter(n => n !== 'bridge' && n !== 'default' && n !== 'host' && n !== 'none');
    if (customNetworks.length > 0 && !service.network_mode) {
        doc.networks = Object.fromEntries(customNetworks.map(n => [n, { external: true }]));
    }

    return YAML.stringify(doc, { lineWidth: 0 });
}

/** Triggers a browser download of the compose file for the given spec. */
export function downloadCompose(spec: DockerCreateSpec): void {
    const blob = new Blob([specToCompose(spec)], { type: 'text/yaml;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${composeServiceName(spec)}-compose.yml`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
}
