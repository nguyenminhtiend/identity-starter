// e2e/src/helpers/flow-logger.ts
import type { ApiResponse } from './http-client.js';

const MAX_BODY_LEN = 200;
const MAX_TOKEN_LEN = 20;

const SENSITIVE_KEYS = new Set([
  'password',
  'clientSecret',
  'client_secret',
  'currentPassword',
  'newPassword',
]);

function truncate(str: string, max: number): string {
  return str.length > max ? `${str.slice(0, max)}...` : str;
}

function maskSensitive(obj: unknown): unknown {
  if (obj === null || obj === undefined) {
    return obj;
  }
  if (typeof obj !== 'object') {
    return obj;
  }
  if (Array.isArray(obj)) {
    return obj.map(maskSensitive);
  }
  const masked: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
    if (SENSITIVE_KEYS.has(key)) {
      masked[key] = '***';
    } else if (
      typeof value === 'string' &&
      (key === 'token' || key === 'authorization' || key === 'mfaToken')
    ) {
      masked[key] = truncate(value, MAX_TOKEN_LEN);
    } else {
      masked[key] = maskSensitive(value);
    }
  }
  return masked;
}

function maskHeaders(headers?: Record<string, string>): string {
  if (!headers || Object.keys(headers).length === 0) {
    return '';
  }
  const masked = { ...headers };
  if (masked.authorization) {
    masked.authorization = truncate(masked.authorization, 30);
  }
  return truncate(JSON.stringify(masked), MAX_BODY_LEN);
}

function formatBody(body: unknown): string {
  if (body === null || body === undefined) {
    return '(none)';
  }
  const masked = maskSensitive(body);
  return truncate(JSON.stringify(masked), MAX_BODY_LEN);
}

function pad(str: string, len: number): string {
  return str.padEnd(len);
}

export interface FlowLogger {
  step: <T = unknown>(
    label: string,
    fn: () => Promise<ApiResponse<T>>,
    meta?: { method: string; path: string; body?: unknown; headers?: Record<string, string> },
  ) => Promise<ApiResponse<T>>;
  banner: () => void;
  note: (message: string) => void;
}

export function createFlowLogger(flowName: string): FlowLogger {
  let stepNum = 0;

  return {
    banner() {
      const line = '═'.repeat(62);
      console.log(`\n${line}`);
      console.log(`  ${flowName}`);
      console.log(`${line}\n`);
    },

    note(message: string) {
      console.log(`  💡 ${message}\n`);
    },

    async step<T = unknown>(
      label: string,
      fn: () => Promise<ApiResponse<T>>,
      meta?: { method: string; path: string; body?: unknown; headers?: Record<string, string> },
    ): Promise<ApiResponse<T>> {
      stepNum++;
      const stepLabel = `Step ${stepNum}: ${label}`;
      const methodPath = meta ? `${meta.method} ${meta.path}` : '';
      const headerLine = methodPath ? `${stepLabel} (${methodPath})` : stepLabel;
      const width = 61;

      const res = await fn();

      console.log(`┌${'─'.repeat(width)}┐`);
      console.log(`│ ${pad(headerLine, width - 2)} │`);
      console.log(`├${'──────────'}┬${'─'.repeat(width - 11)}┤`);

      if (meta) {
        const reqLine = meta.body ? formatBody(meta.body) : '(none)';
        console.log(`│ ${pad('Request', 8)} │ ${pad(reqLine, width - 12)} │`);
        if (meta.headers && Object.keys(meta.headers).length > 0) {
          console.log(`│ ${pad('Headers', 8)} │ ${pad(maskHeaders(meta.headers), width - 12)} │`);
        }
        console.log(`├${'──────────'}┼${'─'.repeat(width - 11)}┤`);
      }

      const statusStr = String(res.status);
      console.log(`│ ${pad('Status', 8)} │ ${pad(statusStr, width - 12)} │`);
      const resBody = res.data !== null ? formatBody(res.data) : '(empty)';
      console.log(`│ ${pad('Response', 8)} │ ${pad(resBody, width - 12)} │`);

      const locationHeader = res.headers.get('location');
      if (locationHeader) {
        console.log(
          `│ ${pad('Location', 8)} │ ${pad(truncate(locationHeader, width - 14), width - 12)} │`,
        );
      }

      console.log(`└${'──────────'}┴${'─'.repeat(width - 11)}┘`);
      console.log('');

      return res;
    },
  };
}
