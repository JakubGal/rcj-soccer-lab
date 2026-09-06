'use client';

import { useEffect, useState } from 'react';
import {
  BadgeCheck,
  CircleAlert,
  Globe2,
  Search,
  ShieldCheck,
  UserRoundSearch,
  X,
} from 'lucide-react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { useLocalization } from '@/components/i18n/LocalizationProvider';
import {
  getCertifiedReferees,
  type CertifiedRefereeDirectory,
} from '@/lib/account';
import { useAccount } from './AccountProvider';
import { LoadingCards, useAccountFormatting } from './account-ui';

export function CertifiedRefereesPanel() {
  const { t } = useLocalization();
  const format = useAccountFormatting();
  const { apiBaseUrl, isStaticHost, secureAppUrl } = useAccount();
  const directoryApiBase = apiBaseUrl || (isStaticHost ? secureAppUrl : '');
  const [query, setQuery] = useState('');
  const [directory, setDirectory] = useState<CertifiedRefereeDirectory>({
    referees: [],
    total: 0,
    nextCursor: null,
  });
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      setLoading(true);
      setError(null);
      try {
        const next = await getCertifiedReferees(
          query,
          directoryApiBase,
          controller.signal,
        );
        setDirectory(next);
      } catch (caught) {
        if (caught instanceof DOMException && caught.name === 'AbortError')
          return;
        setError(
          caught instanceof Error
            ? caught.message
            : 'The certified referee directory is temporarily unavailable.',
        );
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }, 250);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [directoryApiBase, query]);

  async function loadMore() {
    if (!directory.nextCursor || loadingMore) return;
    setLoadingMore(true);
    setError(null);
    try {
      const next = await getCertifiedReferees(
        query,
        directoryApiBase,
        undefined,
        directory.nextCursor,
      );
      setDirectory((current) => ({
        referees: [...current.referees, ...next.referees],
        total: next.total,
        nextCursor: next.nextCursor,
      }));
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : 'The certified referee directory is temporarily unavailable.',
      );
    } finally {
      setLoadingMore(false);
    }
  }

  return (
    <div className="grid gap-5">
      <Card className="border-white/10 bg-[#101c28]">
        <CardHeader>
          <div className="flex size-10 items-center justify-center rounded-xl bg-emerald-400/10 text-emerald-300">
            <UserRoundSearch />
          </div>
          <CardTitle className="text-xl">{t('Certified referees')}</CardTitle>
          <CardDescription>
            {t(
              'Search the public registry by referee number or display name. Only certifications issued by this site are shown.',
            )}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <label className="relative block max-w-xl">
            <Search className="pointer-events-none absolute top-2 left-2.5 size-4 text-slate-400" />
            <span className="sr-only">{t('Search certified referees')}</span>
            <Input
              className="pr-9 pl-9"
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Referee number or display name"
              autoComplete="off"
            />
            {query && (
              <Button
                className="absolute top-0.5 right-0.5"
                type="button"
                variant="ghost"
                size="icon-sm"
                onClick={() => setQuery('')}
                aria-label="Clear directory search"
              >
                <X />
              </Button>
            )}
          </label>
        </CardContent>
      </Card>

      {error && (
        <Alert variant="destructive">
          <CircleAlert />
          <AlertTitle>{t('Directory unavailable')}</AlertTitle>
          <AlertDescription>{t(error)}</AlertDescription>
        </Alert>
      )}

      {loading ? (
        <LoadingCards />
      ) : directory.referees.length ? (
        <Card className="border-white/10 bg-[#101c28]">
          <CardHeader>
            <CardTitle className="flex items-center justify-between gap-3">
              <span>{t('Public certification registry')}</span>
              <Badge variant="outline">
                <BadgeCheck />{' '}
                <span data-i18n-skip>{format.number(directory.total)}</span>
              </Badge>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="hidden sm:block">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t('Referee number')}</TableHead>
                    <TableHead>{t('Display name')}</TableHead>
                    <TableHead>{t('Country or region')}</TableHead>
                    <TableHead>{t('Rules edition')}</TableHead>
                    <TableHead>{t('Certified')}</TableHead>
                    <TableHead>{t('Status')}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {directory.referees.map((referee, index) => (
                    <TableRow
                      key={`${referee.refereeNumber}:${referee.verificationCode}:${index}`}
                    >
                      <TableCell className="font-mono" data-i18n-skip>
                        {referee.refereeNumber || '—'}
                      </TableCell>
                      <TableCell data-i18n-skip>
                        {referee.displayName}
                      </TableCell>
                      <TableCell data-i18n-skip>
                        {referee.country || '—'}
                      </TableCell>
                      <TableCell data-i18n-skip>{referee.season}</TableCell>
                      <TableCell data-i18n-skip>
                        {format.date(referee.certifiedAt)}
                      </TableCell>
                      <TableCell>
                        <Badge className="bg-emerald-500/15 text-emerald-300">
                          <ShieldCheck /> {t('Certified')}
                        </Badge>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>

            <div className="grid gap-3 sm:hidden">
              {directory.referees.map((referee, index) => (
                <article
                  key={`${referee.refereeNumber}:${referee.verificationCode}:mobile:${index}`}
                  className="rounded-lg border border-white/10 p-3"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <strong className="block truncate" data-i18n-skip>
                        {referee.displayName}
                      </strong>
                      <span
                        className="font-mono text-xs text-sky-300"
                        data-i18n-skip
                      >
                        {referee.refereeNumber || '—'}
                      </span>
                    </div>
                    <Badge className="bg-emerald-500/15 text-emerald-300">
                      <BadgeCheck /> {t('Certified')}
                    </Badge>
                  </div>
                  <dl className="mt-3 grid grid-cols-2 gap-2 text-xs">
                    <div>
                      <dt className="text-slate-400">{t('Country')}</dt>
                      <dd data-i18n-skip>{referee.country || '—'}</dd>
                    </div>
                    <div>
                      <dt className="text-slate-400">{t('Rules edition')}</dt>
                      <dd data-i18n-skip>{referee.season}</dd>
                    </div>
                    <div className="col-span-2">
                      <dt className="text-slate-400">{t('Certified')}</dt>
                      <dd data-i18n-skip>{format.date(referee.certifiedAt)}</dd>
                    </div>
                  </dl>
                </article>
              ))}
            </div>
            {directory.nextCursor && (
              <div className="mt-4 flex justify-center">
                <Button
                  type="button"
                  variant="outline"
                  disabled={loadingMore}
                  onClick={loadMore}
                >
                  {t(loadingMore ? 'Loading more…' : 'Load more')}
                </Button>
              </div>
            )}
          </CardContent>
        </Card>
      ) : (
        <Card className="border-white/10 bg-[#101c28]">
          <CardContent className="flex min-h-44 flex-col items-center justify-center text-center">
            <Globe2 className="mb-3 size-8 text-slate-500" />
            <strong>{t('No certified referees found')}</strong>
            <p className="mt-1 max-w-md text-sm text-slate-400">
              {t(
                query
                  ? 'Try another referee number or display name.'
                  : 'The public directory will show referees after their certification is verified and public listing is enabled.',
              )}
            </p>
          </CardContent>
        </Card>
      )}

      <DirectoryPrivacyNote />
    </div>
  );
}

function DirectoryPrivacyNote() {
  const { t } = useLocalization();
  return (
    <Alert>
      <ShieldCheck />
      <AlertTitle>{t('Public information is limited')}</AlertTitle>
      <AlertDescription>
        {t(
          'The directory never shows email addresses or private account identifiers. A referee controls whether their public profile is listed.',
        )}
      </AlertDescription>
    </Alert>
  );
}
