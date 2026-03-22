export interface ConsentClient {
  clientId: string;
  clientName: string;
  scope: string;
  logoUri: string | null;
  policyUri: string | null;
  tosUri: string | null;
}

export interface ConsentRequired {
  type: 'consent_required';
  client: ConsentClient;
  requestedScope: string;
  state: string;
  redirectUri: string;
}
