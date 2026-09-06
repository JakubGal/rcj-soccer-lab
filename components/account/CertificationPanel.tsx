'use client';

import { useMemo, useState } from 'react';
import {
  BadgeCheck,
  BookCheck,
  Check,
  CircleAlert,
  Clock3,
  Gamepad2,
  Play,
  RotateCcw,
  ShieldCheck,
  Timer,
} from 'lucide-react';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogMedia,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
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
import type {
  CertificationGameLaunch,
  CertificationMode,
  GameCertificationProgress,
} from '@/lib/account';
import { useAccount } from './AccountProvider';
import {
  AccountAccessCard,
  CertificationStatusBadge,
  LoadingCards,
  useAccountFormatting,
} from './account-ui';

function RequirementCard({
  icon: Icon,
  title,
  summary,
  progress,
  progressLabel,
  passed,
  action,
}: {
  icon: typeof BookCheck;
  title: string;
  summary: string;
  progress: number;
  progressLabel: string;
  passed: boolean;
  action?: React.ReactNode;
}) {
  const { t } = useLocalization();
  return (
    <Card
      className={
        passed
          ? 'border-emerald-400/30 bg-emerald-400/5'
          : 'border-white/10 bg-[#101c28]'
      }
    >
      <CardHeader>
        <div className="mb-2 flex size-9 items-center justify-center rounded-lg bg-sky-400/10 text-sky-300">
          {passed ? <Check /> : <Icon />}
        </div>
        <CardTitle>{title}</CardTitle>
        <CardDescription>{summary}</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="mb-2 flex items-center justify-between gap-2 text-xs text-slate-400">
          <span>{t(passed ? 'Requirement complete' : 'Current progress')}</span>
          <strong className="text-slate-100" data-i18n-skip>
            {progressLabel}
          </strong>
        </div>
        <Progress value={Math.max(0, Math.min(100, progress))} />
      </CardContent>
      {action && <CardFooter className="justify-end">{action}</CardFooter>}
    </Card>
  );
}

function AttemptTable({ track }: { track: GameCertificationProgress }) {
  const { t } = useLocalization();
  const format = useAccountFormatting();
  if (!track.attempts.length)
    return (
      <p className="py-4 text-sm text-slate-400">
        {t('No attempts in this mode yet.')}
      </p>
    );
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>{t('Attempt')}</TableHead>
          <TableHead>{t('Length')}</TableHead>
          <TableHead>{t('Accuracy')}</TableHead>
          <TableHead>{t('Decision')}</TableHead>
          <TableHead>{t('Date')}</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {track.attempts.map((attempt) => (
          <TableRow key={attempt.id}>
            <TableCell data-i18n-skip>#{attempt.attemptNumber}</TableCell>
            <TableCell data-i18n-skip>
              {format.duration(attempt.durationSeconds)}
            </TableCell>
            <TableCell data-i18n-skip>
              {format.percent(attempt.accuracy)}
            </TableCell>
            <TableCell>
              <Badge
                variant={attempt.qualifying ? 'default' : 'outline'}
                className={
                  attempt.qualifying
                    ? 'bg-emerald-500/15 text-emerald-300'
                    : undefined
                }
              >
                {t(
                  attempt.qualifying
                    ? 'Qualifying'
                    : attempt.completed
                      ? 'Below target'
                      : 'Incomplete',
                )}
              </Badge>
            </TableCell>
            <TableCell data-i18n-skip>
              {format.date(attempt.completedAt)}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

export function CertificationPanel({
  onOpenRules,
  onLaunchGame,
}: {
  onOpenRules?: (roundId: string) => void;
  onLaunchGame?: (launch: CertificationGameLaunch) => void;
}) {
  const { t } = useLocalization();
  const format = useAccountFormatting();
  const {
    status,
    account,
    error,
    busyAction,
    beginCertification,
    resetCertification,
    beginCertificationGame,
  } = useAccount();
  const [launchError, setLaunchError] = useState<string | null>(null);
  const round = account?.certification ?? null;

  const launch = async (mode: CertificationMode) => {
    if (!round) return;
    setLaunchError(null);
    try {
      const attempt = await beginCertificationGame({
        roundId: round.id,
        mode,
        purpose: 'certification',
      });
      if (!attempt.attemptId)
        throw new Error('The server did not issue a certification attempt.');
      if (onLaunchGame) onLaunchGame(attempt);
      else
        setLaunchError(
          'The attempt was created, but the referee simulator is not connected to this page yet.',
        );
    } catch (caught) {
      setLaunchError(
        caught instanceof Error
          ? caught.message
          : 'The certification game could not be started.',
      );
    }
  };

  const attempts = useMemo(
    () => [
      ...(round?.step.attempts ?? []),
      ...(round?.continuous.attempts ?? []),
    ],
    [round],
  );

  if (status === 'loading') return <LoadingCards />;
  if (status !== 'authenticated' || !account)
    return (
      <div className="grid gap-5">
        <AccountAccessCard page="certification" />
        <CertificationRequirementsOverview />
      </div>
    );

  if (!round)
    return (
      <div className="grid gap-5">
        {error && (
          <Alert variant="destructive">
            <AlertTitle>{t('Certification could not be started')}</AlertTitle>
            <AlertDescription>{t(error)}</AlertDescription>
          </Alert>
        )}
        <Card className="border-sky-400/25 bg-gradient-to-br from-[#123047] to-[#0d1721]">
          <CardHeader>
            <div className="mb-2 flex size-11 items-center justify-center rounded-xl bg-sky-300 text-slate-950">
              <ShieldCheck />
            </div>
            <CardTitle className="text-xl">
              {t('2026 referee certification')}
            </CardTitle>
            <CardDescription className="max-w-3xl text-sm leading-6">
              {t(
                'Start a certification round when you are ready. The rules examination records the first answer, and referee games use fixed ten-minute certification settings.',
              )}
            </CardDescription>
          </CardHeader>
          <CardFooter>
            <Button
              onClick={() => void beginCertification()}
              disabled={busyAction === 'start-certification'}
            >
              <Play />
              {t(
                busyAction === 'start-certification'
                  ? 'Starting…'
                  : 'Start certification round',
              )}
            </Button>
          </CardFooter>
        </Card>
        <CertificationRequirementsOverview />
      </div>
    );

  const rules = round.rules;
  const rulesCompletion = rules.total
    ? (100 * rules.answered) / rules.total
    : 0;
  const allPassed =
    rules.passed && round.step.passed && round.continuous.passed;
  const roundFailed = round.status === 'failed';

  return (
    <div className="grid gap-5">
      {(error || launchError) && (
        <Alert variant="destructive">
          <CircleAlert />
          <AlertTitle>{t('Certification action failed')}</AlertTitle>
          <AlertDescription>{t(launchError ?? error ?? '')}</AlertDescription>
        </Alert>
      )}

      <section className="flex flex-col gap-3 rounded-xl border border-white/10 bg-[#0e1c27] p-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="text-xs tracking-widest text-slate-400 uppercase">
            {t('Current certification round')}
          </p>
          <h2 className="mt-1 text-xl font-semibold">
            {t('Round')} <span data-i18n-skip>{round.number}</span> ·{' '}
            <span data-i18n-skip>{round.season}</span>
          </h2>
          <p className="mt-1 text-sm text-slate-400">
            {t('Started')}{' '}
            <span data-i18n-skip>{format.date(round.startedAt)}</span>
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <CertificationStatusBadge
            status={allPassed ? 'qualified' : round.status}
          />
          <AlertDialog>
            <AlertDialogTrigger render={<Button variant="outline" size="sm" />}>
              <RotateCcw /> {t('Restart certification')}
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogMedia>
                  <CircleAlert />
                </AlertDialogMedia>
                <AlertDialogTitle>
                  {t('Restart the complete certification round?')}
                </AlertDialogTitle>
                <AlertDialogDescription>
                  {t(
                    'This resets all certification rule answers and game attempts. Your normal practice history remains in your profile, and this round stays in the audit history.',
                  )}
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>{t('Keep this round')}</AlertDialogCancel>
                <AlertDialogAction
                  variant="destructive"
                  disabled={busyAction === 'restart-certification'}
                  onClick={() => void resetCertification()}
                >
                  {t('Restart everything')}
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>
      </section>

      {allPassed && (
        <Alert className="border-emerald-400/40 bg-emerald-400/10 p-4">
          <BadgeCheck />
          <AlertTitle>
            {t('All certification requirements are complete')}
          </AlertTitle>
          <AlertDescription>
            {t(
              'Your referee certificate has been issued. If public listing is enabled, it can appear in the Certified referees directory.',
            )}
          </AlertDescription>
        </Alert>
      )}

      {roundFailed && (
        <Alert className="border-rose-400/40 bg-rose-400/10 p-4">
          <CircleAlert />
          <AlertTitle>{t('This certification round has failed')}</AlertTitle>
          <AlertDescription>
            {t(
              'One or more requirements can no longer be reached in this round. Review the results, then restart the complete certification when you are ready to try again.',
            )}
          </AlertDescription>
        </Alert>
      )}

      <div className="grid gap-4 xl:grid-cols-3">
        <RequirementCard
          icon={BookCheck}
          title={t('Rules examination')}
          summary={`${t('Answer every assigned question. At least')} ${rules.requiredAccuracy}% ${t('must be correct on the first answer.')}`}
          progress={rulesCompletion}
          progressLabel={`${rules.answered} / ${rules.total || '—'} · ${format.percent(rules.accuracy)}`}
          passed={rules.passed}
          action={
            !rules.passed &&
            !roundFailed && (
              <Button
                size="sm"
                disabled={!onOpenRules}
                onClick={() => onOpenRules?.(round.id)}
              >
                <BookCheck />
                {t(rules.answered ? 'Continue questions' : 'Begin questions')}
              </Button>
            )
          }
        />
        <GameRequirementCard
          track={round.step}
          onStart={() => void launch('step')}
          busy={busyAction === 'start-game'}
          roundFailed={roundFailed}
        />
        <GameRequirementCard
          track={round.continuous}
          onStart={() => void launch('continuous')}
          busy={busyAction === 'start-game'}
          roundFailed={roundFailed}
        />
      </div>

      <Card className="border-white/10 bg-[#101c28]">
        <CardHeader>
          <CardTitle>{t('Certification game attempts')}</CardTitle>
          <CardDescription>
            {t(
              'Every started certification game uses one attempt. Ending early does not qualify the game.',
            )}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {attempts.length ? (
            <div className="grid gap-5 xl:grid-cols-2">
              <section>
                <h3 className="mb-2 flex items-center gap-2 font-medium">
                  <Gamepad2 /> {t('Step mode')}
                </h3>
                <AttemptTable track={round.step} />
              </section>
              <section>
                <h3 className="mb-2 flex items-center gap-2 font-medium">
                  <Timer /> {t('Continuous mode')}
                </h3>
                <AttemptTable track={round.continuous} />
              </section>
            </div>
          ) : (
            <p className="py-5 text-sm text-slate-400">
              {t('No certification games have been started in this round.')}
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function GameRequirementCard({
  track,
  onStart,
  busy,
  roundFailed,
}: {
  track: GameCertificationProgress;
  onStart: () => void;
  busy: boolean;
  roundFailed: boolean;
}) {
  const { t } = useLocalization();
  const exhausted = track.attemptsUsed >= track.attemptsAllowed;
  const modeName = track.mode === 'step' ? 'Step mode' : 'Continuous mode';
  return (
    <RequirementCard
      icon={track.mode === 'step' ? Gamepad2 : Timer}
      title={t(modeName)}
      summary={`${track.requiredGames} × 10:00 ${t('games at or above')} ${track.requiredAccuracy}% · ${track.attemptsAllowed} ${t('attempts available')}`}
      progress={
        (100 * track.qualifyingGames) / Math.max(1, track.requiredGames)
      }
      progressLabel={`${track.qualifyingGames} / ${track.requiredGames} · ${track.attemptsUsed} / ${track.attemptsAllowed} ${t('attempts')}`}
      passed={track.passed}
      action={
        !track.passed && (
          <Button
            size="sm"
            disabled={busy || exhausted || roundFailed}
            onClick={onStart}
          >
            <Play />
            {t(
              roundFailed
                ? 'Restart required'
                : exhausted
                  ? 'Attempts exhausted'
                  : `Start ${modeName.toLowerCase()} game`,
            )}
          </Button>
        )
      }
    />
  );
}

function CertificationRequirementsOverview() {
  const { t } = useLocalization();
  const rows = [
    {
      icon: BookCheck,
      title: 'Rules examination',
      value: '95%',
      detail: 'Correct on the first answer across all assigned questions',
    },
    {
      icon: Gamepad2,
      title: 'Step mode',
      value: '5 / 8',
      detail:
        'Five qualifying 10-minute games at 90% or higher, from eight attempts',
    },
    {
      icon: Clock3,
      title: 'Continuous mode',
      value: '2 / 5',
      detail:
        'Two qualifying 10-minute games at 80% or higher, from five attempts',
    },
  ];
  return (
    <section>
      <p className="mb-3 text-xs tracking-widest text-slate-400 uppercase">
        {t('Qualification requirements')}
      </p>
      <div className="grid gap-3 md:grid-cols-3">
        {rows.map(({ icon: Icon, title, value, detail }) => (
          <Card key={title} size="sm" className="border-white/10 bg-[#101c28]">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Icon className="text-sky-300" /> {t(title)}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <strong className="block text-2xl" data-i18n-skip>
                {value}
              </strong>
              <p className="mt-2 text-xs leading-5 text-slate-400">
                {t(detail)}
              </p>
            </CardContent>
          </Card>
        ))}
      </div>
    </section>
  );
}
