interface ScopeInfo {
  label: string;
  description: string;
}

const SCOPE_MAP: Record<string, ScopeInfo> = {
  openid: {
    label: 'OpenID',
    description: 'Verify your identity',
  },
  profile: {
    label: 'Profile',
    description: 'Access your name and profile information',
  },
  email: {
    label: 'Email',
    description: 'Access your email address',
  },
  offline_access: {
    label: 'Offline access',
    description: 'Access your data when you are not present',
  },
};

export function getScopeDescriptions(scopeString: string): ScopeInfo[] {
  return scopeString
    .split(' ')
    .filter(Boolean)
    .map((scope) => SCOPE_MAP[scope] ?? { label: scope, description: `Access to ${scope}` });
}
