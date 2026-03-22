'use client';

import { CheckCircle2, ExternalLink, Shield } from 'lucide-react';
import { useState } from 'react';
import { LoadingButton } from '@/components/shared/loading-button';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Separator } from '@/components/ui/separator';
import type { ConsentRequired } from '@/types/oauth';
import { getScopeDescriptions } from './scope-descriptions';

interface ConsentFormProps {
  data: ConsentRequired;
  authorizeParams: Record<string, string>;
}

export function ConsentForm({ data, authorizeParams }: ConsentFormProps) {
  const [submitting, setSubmitting] = useState<'approve' | 'deny' | null>(null);
  const scopes = getScopeDescriptions(data.requestedScope);

  function handleDecision(decision: 'approve' | 'deny') {
    setSubmitting(decision);

    const body: Record<string, string> = {
      client_id: data.client.clientId,
      scope: data.requestedScope,
      decision,
      state: data.state,
      redirect_uri: data.redirectUri,
    };

    if (decision === 'approve') {
      if (authorizeParams.code_challenge) {
        body.code_challenge = authorizeParams.code_challenge;
      }
      if (authorizeParams.code_challenge_method) {
        body.code_challenge_method = authorizeParams.code_challenge_method;
      }
      if (authorizeParams.nonce) {
        body.nonce = authorizeParams.nonce;
      }
    }

    const form = document.createElement('form');
    form.method = 'POST';
    form.action = '/oauth/consent';
    for (const [key, value] of Object.entries(body)) {
      const input = document.createElement('input');
      input.type = 'hidden';
      input.name = key;
      input.value = value;
      form.appendChild(input);
    }
    document.body.appendChild(form);
    form.submit();
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-muted/40 px-4">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          {data.client.logoUri ? (
            // biome-ignore lint/performance/noImgElement: external URL from OAuth client registration
            <img
              src={data.client.logoUri}
              alt={data.client.clientName}
              className="mx-auto mb-4 h-16 w-16 rounded-lg"
            />
          ) : null}
          <CardTitle className="font-display text-xl">
            {data.client.clientName} wants to access your account
          </CardTitle>
          <CardDescription>
            This application is requesting the following permissions
          </CardDescription>
        </CardHeader>

        <CardContent className="space-y-4">
          <div className="space-y-3">
            {scopes.map((scope) => (
              <div key={scope.label} className="flex items-start gap-3">
                <CheckCircle2 className="mt-0.5 h-4 w-4 text-green-600" />
                <div>
                  <p className="text-sm font-medium">{scope.label}</p>
                  <p className="text-xs text-muted-foreground">{scope.description}</p>
                </div>
              </div>
            ))}
          </div>

          <Separator />

          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Shield className="h-3 w-3" />
            <span>
              This will not share your password.{' '}
              {data.client.policyUri ? (
                <a
                  href={data.client.policyUri}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 text-primary hover:underline"
                >
                  Privacy policy <ExternalLink className="h-3 w-3" />
                </a>
              ) : null}
              {data.client.tosUri ? (
                <>
                  {data.client.policyUri ? ' · ' : null}
                  <a
                    href={data.client.tosUri}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 text-primary hover:underline"
                  >
                    Terms of service <ExternalLink className="h-3 w-3" />
                  </a>
                </>
              ) : null}
            </span>
          </div>
        </CardContent>

        <CardFooter className="flex gap-3">
          <Button
            variant="outline"
            className="flex-1"
            disabled={submitting !== null}
            onClick={() => handleDecision('deny')}
          >
            {submitting === 'deny' ? 'Denying...' : 'Deny'}
          </Button>
          <LoadingButton
            className="flex-1"
            loading={submitting === 'approve'}
            disabled={submitting !== null}
            onClick={() => handleDecision('approve')}
          >
            Allow
          </LoadingButton>
        </CardFooter>
      </Card>
    </div>
  );
}
