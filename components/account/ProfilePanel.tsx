'use client';

import { useMemo, useState, type SyntheticEvent } from 'react';
import {
  BadgeCheck,
  BookCheck,
  CalendarDays,
  Check,
  Gamepad2,
  Globe2,
  Pencil,
  Save,
  ShieldCheck,
  X,
} from 'lucide-react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
} from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Progress } from '@/components/ui/progress';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { useLocalization } from '@/components/i18n/LocalizationProvider';
import { useAccount } from './AccountProvider';
import {
  AccountAccessCard,
  CertificationStatusBadge,
  LoadingCards,
  useAccountFormatting,
} from './account-ui';

function initials(value: string) {
  return value
    .trim()
    .split(/\s+/u)
    .slice(0, 2)
    .map((part) => part[0] ?? '')
    .join('')
    .toUpperCase();
}

function MetricCard({
  icon: Icon,
  label,
  value,
  detail,
}: {
  icon: typeof BookCheck;
  label: string;
  value: string;
  detail: string;
}) {
  return (
    <Card size="sm" className="border-white/10 bg-[#101c28]">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-slate-300">
          <Icon className="text-sky-300" /> {label}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <strong className="block text-2xl text-slate-50" data-i18n-skip>
          {value}
        </strong>
        <p className="mt-1 text-xs text-slate-400">{detail}</p>
      </CardContent>
    </Card>
  );
}

export function ProfilePanel() {
  const { t } = useLocalization();
  const format = useAccountFormatting();
  const { status, account, error, busyAction, updateProfile } = useAccount();
  const profile = account?.profile ?? null;
  const [editing, setEditing] = useState(false);
  const [displayName, setDisplayName] = useState('');
  const [country, setCountry] = useState('');
  const [publicProfile, setPublicProfile] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const submit = async (event: SyntheticEvent<HTMLFormElement>) => {
    event.preventDefault();
    const name = displayName.trim();
    if (name.length < 2 || name.length > 60) {
      setFormError('Use a public display name between 2 and 60 characters.');
      return;
    }
    setFormError(null);
    setSaved(false);
    try {
      await updateProfile({
        displayName: name,
        country: country.trim(),
        publicProfile,
      });
      setEditing(false);
      setSaved(true);
    } catch {
      // AccountProvider exposes the translated display-safe error region.
    }
  };

  const recentGames = useMemo(
    () =>
      [...(account?.recentGames ?? [])].sort((a, b) =>
        (b.completedAt ?? '').localeCompare(a.completedAt ?? ''),
      ),
    [account?.recentGames],
  );

  if (status === 'loading') return <LoadingCards />;
  if (status !== 'authenticated' || !account || !profile)
    return <AccountAccessCard page="profile" />;

  const stats = account.practice;
  const rulesPercent = stats.ruleChecksTotal
    ? (100 * stats.ruleChecksCompleted) / stats.ruleChecksTotal
    : 0;
  const certificationStatus = account.certification?.status ?? 'not-started';

  return (
    <div className="grid gap-5">
      {error && (
        <Alert variant="destructive">
          <AlertTitle>{t('Account action failed')}</AlertTitle>
          <AlertDescription>{t(error)}</AlertDescription>
        </Alert>
      )}
      {saved && (
        <Alert className="border-emerald-400/30 bg-emerald-400/5">
          <Check />
          <AlertTitle>{t('Profile saved')}</AlertTitle>
        </Alert>
      )}

      <Card className="border-sky-400/20 bg-gradient-to-br from-[#122939] to-[#0d1721]">
        <CardHeader>
          <div className="flex min-w-0 items-center gap-3">
            <Avatar size="lg">
              <AvatarFallback data-i18n-skip>
                {initials(profile.displayName) || 'R'}
              </AvatarFallback>
            </Avatar>
            <div className="min-w-0">
              <CardTitle className="truncate text-lg" data-i18n-skip>
                {profile.displayName}
              </CardTitle>
              <CardDescription className="flex flex-wrap items-center gap-2">
                {profile.refereeNumber ? (
                  <span className="font-mono" data-i18n-skip>
                    {profile.refereeNumber}
                  </span>
                ) : (
                  t('Referee number will be assigned by the server')
                )}
                <CertificationStatusBadge status={certificationStatus} />
              </CardDescription>
            </div>
          </div>
          <CardAction>
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                if (editing) {
                  setEditing(false);
                  return;
                }
                setDisplayName(profile.displayName);
                setCountry(profile.country);
                setPublicProfile(profile.publicProfile);
                setFormError(null);
                setSaved(false);
                setEditing(true);
              }}
            >
              {editing ? <X /> : <Pencil />}
              {t(editing ? 'Cancel' : 'Edit profile')}
            </Button>
          </CardAction>
        </CardHeader>
        <CardContent>
          {editing ? (
            <form onSubmit={submit} className="max-w-xl">
              <FieldGroup>
                <Field data-invalid={Boolean(formError)}>
                  <FieldLabel htmlFor="account-display-name">
                    {t('Public display name')}
                  </FieldLabel>
                  <Input
                    id="account-display-name"
                    maxLength={60}
                    autoComplete="nickname"
                    value={displayName}
                    onChange={(event) => setDisplayName(event.target.value)}
                  />
                  <FieldDescription>
                    {t(
                      'This name can appear in the certified referee directory.',
                    )}
                  </FieldDescription>
                  <FieldError>{formError && t(formError)}</FieldError>
                </Field>
                <Field>
                  <FieldLabel htmlFor="account-country">
                    {t('Country or region')}
                  </FieldLabel>
                  <Input
                    id="account-country"
                    maxLength={80}
                    autoComplete="country-name"
                    value={country}
                    onChange={(event) => setCountry(event.target.value)}
                  />
                </Field>
                <Field orientation="horizontal">
                  <Checkbox
                    id="account-public-profile"
                    checked={publicProfile}
                    onCheckedChange={(checked) =>
                      setPublicProfile(checked === true)
                    }
                  />
                  <FieldLabel htmlFor="account-public-profile">
                    {t(
                      'List my referee number, display name and country publicly after certification',
                    )}
                  </FieldLabel>
                </Field>
                <Button
                  className="w-fit"
                  type="submit"
                  disabled={busyAction === 'profile'}
                >
                  <Save />
                  {t(busyAction === 'profile' ? 'Saving…' : 'Save profile')}
                </Button>
              </FieldGroup>
            </form>
          ) : (
            <dl className="grid gap-4 text-sm sm:grid-cols-3">
              <div>
                <dt className="flex items-center gap-1.5 text-slate-400">
                  <Globe2 className="size-4" /> {t('Country or region')}
                </dt>
                <dd className="mt-1 text-slate-100" data-i18n-skip>
                  {profile.country || '—'}
                </dd>
              </div>
              <div>
                <dt className="flex items-center gap-1.5 text-slate-400">
                  <CalendarDays className="size-4" /> {t('Member since')}
                </dt>
                <dd className="mt-1 text-slate-100" data-i18n-skip>
                  {format.date(profile.createdAt)}
                </dd>
              </div>
              <div>
                <dt className="flex items-center gap-1.5 text-slate-400">
                  <ShieldCheck className="size-4" /> {t('Directory listing')}
                </dt>
                <dd className="mt-1 text-slate-100">
                  {t(profile.publicProfile ? 'Enabled' : 'Hidden')}
                </dd>
              </div>
            </dl>
          )}
        </CardContent>
      </Card>

      <section aria-labelledby="practice-summary-heading">
        <div className="mb-3 flex items-center justify-between gap-3">
          <div>
            <p className="text-xs tracking-widest text-slate-400 uppercase">
              {t('Practice record')}
            </p>
            <h2 id="practice-summary-heading" className="text-lg font-semibold">
              {t('Your learning progress')}
            </h2>
          </div>
          <Badge variant="outline">
            <Gamepad2 /> {format.number(stats.refereeGamesPlayed)} {t('games')}
          </Badge>
        </div>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <Card size="sm" className="border-white/10 bg-[#101c28]">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-slate-300">
                <BookCheck className="text-sky-300" /> {t('Rule checks')}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <strong className="block text-2xl" data-i18n-skip>
                {format.number(stats.ruleChecksCompleted)} /{' '}
                {stats.ruleChecksTotal
                  ? format.number(stats.ruleChecksTotal)
                  : '—'}
              </strong>
              <Progress
                className="mt-3"
                value={rulesPercent}
                aria-label="Rule learning progress"
              />
            </CardContent>
          </Card>
          <MetricCard
            icon={Gamepad2}
            label={t('Step games')}
            value={format.number(stats.stepGamesPlayed)}
            detail={`${t('Weighted accuracy')} · ${format.percent(stats.stepAccuracy)}`}
          />
          <MetricCard
            icon={Gamepad2}
            label={t('Continuous games')}
            value={format.number(stats.continuousGamesPlayed)}
            detail={`${t('Weighted accuracy')} · ${format.percent(stats.continuousAccuracy)}`}
          />
          <MetricCard
            icon={BadgeCheck}
            label={t('Certification')}
            value={t(
              certificationStatus === 'qualified'
                ? 'Certified'
                : certificationStatus === 'in-progress'
                  ? 'In progress'
                  : 'Not certified',
            )}
            detail={
              account.certification
                ? `${t('Round')} ${account.certification.number} · ${account.certification.season}`
                : t('Start when you are ready')
            }
          />
        </div>
      </section>

      <div className="grid gap-4 xl:grid-cols-2">
        <Card className="border-white/10 bg-[#101c28]">
          <CardHeader>
            <CardTitle>{t('Recent referee games')}</CardTitle>
            <CardDescription>
              {t(
                'Practice and completed simulator sessions saved to your account.',
              )}
            </CardDescription>
          </CardHeader>
          <CardContent>
            {recentGames.length ? (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t('Mode')}</TableHead>
                    <TableHead>{t('Length')}</TableHead>
                    <TableHead>{t('Accuracy')}</TableHead>
                    <TableHead>{t('Date')}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {recentGames.slice(0, 8).map((game) => (
                    <TableRow key={game.id}>
                      <TableCell>
                        {t(game.mode === 'step' ? 'Step' : 'Continuous')}
                      </TableCell>
                      <TableCell data-i18n-skip>
                        {format.duration(game.durationSeconds)}
                      </TableCell>
                      <TableCell data-i18n-skip>
                        {format.percent(game.accuracy)}
                      </TableCell>
                      <TableCell data-i18n-skip>
                        {format.date(game.completedAt)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            ) : (
              <p className="py-5 text-sm text-slate-400">
                {t(
                  'No saved referee games yet. Guest practice is still available from the Referee tab.',
                )}
              </p>
            )}
          </CardContent>
        </Card>

        <Card className="border-white/10 bg-[#101c28]">
          <CardHeader>
            <CardTitle>{t('Certification history')}</CardTitle>
            <CardDescription>
              {t(
                'Earlier rounds remain visible even when a new round is started.',
              )}
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-2">
            {account.certificationHistory.length ? (
              account.certificationHistory.slice(0, 8).map((round) => (
                <div
                  key={round.id}
                  className="flex items-center justify-between gap-3 rounded-lg border border-white/10 p-3"
                >
                  <div>
                    <strong>
                      {t('Round')}{' '}
                      <span data-i18n-skip>{round.roundNumber}</span>
                    </strong>
                    <p className="text-xs text-slate-400">
                      <span data-i18n-skip>{round.season}</span> ·{' '}
                      <span data-i18n-skip>{format.date(round.startedAt)}</span>
                    </p>
                  </div>
                  <CertificationStatusBadge status={round.status} />
                </div>
              ))
            ) : (
              <p className="py-5 text-sm text-slate-400">
                {t('No certification rounds yet.')}
              </p>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
