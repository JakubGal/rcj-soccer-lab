'use client';

import { useId, useState } from 'react';
import {
  Check,
  Copy,
  ExternalLink,
  GitBranch,
  RefreshCw,
  ShieldCheck,
} from 'lucide-react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button, buttonVariants } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Textarea } from '@/components/ui/textarea';
import { useLocalization } from '@/components/i18n/LocalizationProvider';
import { useAccount } from './AccountProvider';

export function GitHubSubmissionPanel({
  kind,
}: {
  kind: 'connect' | 'certify';
}) {
  const { t } = useLocalization();
  const { account, github, prepareGitHubSubmission, checkGitHubSubmission } =
    useAccount();
  const [consented, setConsented] = useState(false);
  const [updateRequested, setUpdateRequested] = useState(false);
  const [busy, setBusy] = useState<'prepare' | 'check' | null>(null);
  const [copiedRequest, setCopiedRequest] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const consentId = useId();
  const packetId = useId();
  const request = github.request?.kind === kind ? github.request : null;
  const receipt =
    github.receipt?.kind === kind &&
    (!request || github.receipt.requestId === request.requestId)
      ? github.receipt
      : null;
  // The current certificate is independently verified by AccountProvider. A
  // later profile-update receipt must not hide that certificate or re-offer it.
  const accepted =
    kind === 'certify'
      ? account?.certification?.status === 'qualified'
      : receipt?.status === 'accepted';
  const rejected = receipt?.status === 'rejected';
  const connected = kind === 'connect' && github.connected;
  const pending = request !== null && receipt === null;

  async function prepare() {
    if (!consented) return;
    setBusy('prepare');
    setError(null);
    try {
      await prepareGitHubSubmission(kind);
      setCopiedRequest(null);
      setUpdateRequested(false);
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : 'The GitHub submission could not be prepared.',
      );
    } finally {
      setBusy(null);
    }
  }

  async function copy() {
    if (!request) return;
    setError(null);
    try {
      await navigator.clipboard.writeText(request.body);
      setCopiedRequest(request.requestId);
    } catch {
      setError(
        'Clipboard access was blocked. Expand the submission text below, select it and copy it manually.',
      );
    }
  }

  async function check() {
    setBusy('check');
    setError(null);
    try {
      await checkGitHubSubmission();
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : 'The verification result could not be checked.',
      );
    } finally {
      setBusy(null);
    }
  }

  return (
    <Card className="border-sky-400/20 bg-[#101c28]">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <GitBranch className="text-sky-300" />
          {t(
            kind === 'connect' ? 'GitHub identity' : 'Submit for verification',
          )}
        </CardTitle>
        <CardDescription className="max-w-3xl leading-6">
          {t(
            kind === 'connect'
              ? 'GitHub confirms your identity from the author of a public issue and assigns your referee number. This site never asks for your GitHub password or access token.'
              : 'The automated reviewer checks your submitted answers and game evidence. Only an accepted, digitally signed result can add you to the training certification registry.',
          )}
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4">
        {(accepted || connected) && (
          <Alert className="border-emerald-400/30 bg-emerald-400/5">
            <ShieldCheck />
            <AlertTitle>
              {t(
                kind === 'connect'
                  ? 'GitHub identity verified'
                  : 'Training certification verified',
              )}
            </AlertTitle>
            <AlertDescription>
              {receipt && (
                <span data-i18n-skip>
                  @{receipt.githubLogin} · {receipt.refereeNumber}
                </span>
              )}
              {!receipt && account?.profile?.refereeNumber && (
                <span data-i18n-skip>{account.profile.refereeNumber}</span>
              )}
              {kind === 'certify' && (
                <p className="mt-2">
                  {t(
                    'This verifies completion of the training programme. It is not an official competition appointment.',
                  )}
                </p>
              )}
            </AlertDescription>
          </Alert>
        )}

        {rejected && (
          <Alert variant="destructive">
            <AlertTitle>{t('Submission not accepted')}</AlertTitle>
            <AlertDescription>{t(receipt.message)}</AlertDescription>
          </Alert>
        )}

        {connected && !pending && !updateRequested && (
          <div className="grid gap-2">
            <p className="text-sm text-slate-400">
              {t(
                'Changed your display name, country or directory preference? Submit an updated GitHub profile to update your public registry entry. Earlier issues remain public.',
              )}
            </p>
            <Button
              className="w-fit"
              variant="outline"
              onClick={() => {
                setConsented(false);
                setUpdateRequested(true);
              }}
            >
              <RefreshCw /> {t('Update public GitHub profile')}
            </Button>
          </div>
        )}

        {((!accepted && !connected) || pending || updateRequested) && (
          <>
            <Alert className="border-amber-400/25 bg-amber-400/5">
              <AlertTitle>{t('Your submission will be public')}</AlertTitle>
              <AlertDescription>
                {t(
                  'GitHub issues are public. Your GitHub username, chosen display name and optional country will be visible. Certification submissions also include your answers and game action logs. Do not include an email address, password or other private information.',
                )}
              </AlertDescription>
            </Alert>

            {!request || rejected || updateRequested ? (
              <div className="grid gap-3">
                <div className="flex items-start gap-2">
                  <Checkbox
                    id={consentId}
                    checked={consented}
                    onCheckedChange={(checked) =>
                      setConsented(checked === true)
                    }
                  />
                  <label
                    htmlFor={consentId}
                    className="text-sm leading-5 text-slate-300"
                  >
                    {t(
                      'I understand this is a public submission and have checked my display name and country.',
                    )}
                  </label>
                </div>
                <Button
                  className="w-fit"
                  disabled={!consented || busy !== null}
                  onClick={() => void prepare()}
                >
                  <GitBranch />
                  {t(
                    busy === 'prepare'
                      ? 'Preparing submission…'
                      : kind === 'connect'
                        ? connected
                          ? 'Prepare profile update'
                          : 'Connect through GitHub'
                        : 'Prepare certification submission',
                  )}
                </Button>
              </div>
            ) : (
              <div className="grid gap-3">
                <ol className="list-decimal space-y-2 pl-5 text-sm leading-6 text-slate-300">
                  <li>{t('Copy the submission text below.')}</li>
                  <li>
                    {t(
                      'Open the GitHub issue, sign in there, paste the copied text into its description and submit the issue.',
                    )}
                  </li>
                  <li>
                    {t(
                      'Return here and check the result. Automated review is asynchronous and may take a few minutes.',
                    )}
                  </li>
                </ol>
                <div className="flex flex-wrap gap-2">
                  <Button variant="outline" onClick={() => void copy()}>
                    {copiedRequest === request.requestId ? <Check /> : <Copy />}
                    {t(
                      copiedRequest === request.requestId
                        ? 'Submission copied'
                        : 'Copy submission',
                    )}
                  </Button>
                  <a
                    href={request.issueUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className={buttonVariants({ variant: 'outline' })}
                  >
                    <ExternalLink /> {t('Open GitHub issue')}
                  </a>
                  <Button disabled={busy !== null} onClick={() => void check()}>
                    <RefreshCw
                      className={busy === 'check' ? 'animate-spin' : ''}
                    />
                    {t(
                      busy === 'check'
                        ? 'Checking…'
                        : 'Check verification result',
                    )}
                  </Button>
                </div>
                <output className="text-xs text-slate-400">
                  {t(
                    'Awaiting a signed verification result. Preparing or opening an issue does not submit it for you.',
                  )}
                </output>
                <details className="rounded-lg border border-white/10 p-3">
                  <summary className="cursor-pointer text-sm text-slate-300">
                    {t('View or copy submission text manually')}
                  </summary>
                  <label htmlFor={packetId} className="sr-only">
                    {t('GitHub submission text')}
                  </label>
                  <Textarea
                    id={packetId}
                    className="mt-3 max-h-52 min-h-32 font-mono text-xs [field-sizing:fixed]"
                    value={request.body}
                    readOnly
                    spellCheck={false}
                    onFocus={(event) => event.target.select()}
                    data-i18n-skip
                  />
                </details>
              </div>
            )}
          </>
        )}
        {error && (
          <Alert variant="destructive">
            <AlertTitle>{t('GitHub submission action failed')}</AlertTitle>
            <AlertDescription>{t(error)}</AlertDescription>
          </Alert>
        )}
        {receipt &&
          Number.isSafeInteger(receipt.issueNumber) &&
          receipt.issueNumber > 0 && (
            <a
              href={`https://github.com/JakubGal/rcj-soccer-lab/issues/${receipt.issueNumber}`}
              target="_blank"
              rel="noopener noreferrer"
              className="flex w-fit items-center gap-1.5 text-sm text-sky-300 underline underline-offset-4"
            >
              <ExternalLink className="size-4" />{' '}
              {t('View verification issue on GitHub')}
            </a>
          )}
      </CardContent>
    </Card>
  );
}
