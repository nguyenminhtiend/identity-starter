import { AlertCircle } from 'lucide-react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { ApiRequestError } from '@/lib/api-client';

interface ApiErrorAlertProps {
  error: Error | null;
}

export function ApiErrorAlert({ error }: ApiErrorAlertProps) {
  if (!error) {
    return null;
  }

  const message = error instanceof ApiRequestError ? error.body.error : error.message;

  return (
    <Alert variant="destructive">
      <AlertCircle className="h-4 w-4" />
      <AlertDescription>{message}</AlertDescription>
    </Alert>
  );
}
