import { OnboardingScreen } from '@ticash/core';
import { useI18n } from '@ticash/i18n';

/** Agent onboarding: same hero, but agent-facing copy (not customer remittance marketing). */
export default function AgentOnboarding() {
  const { t } = useI18n();
  return <OnboardingScreen title={t('agent.onboardingTitle')} subtitle={t('agent.onboardingSubtitle')} />;
}
