/** Ticash Pay copy. EN is the source of truth for the shape; PT/FR must match it. */
export const en = {
  common: { appName: 'Ticash Pay', continue: 'Continue', cancel: 'Cancel', back: 'Back', retry: 'Retry', loading: 'Loading…', error: 'Something went wrong' },
  onboarding: {
    title: 'Send money home, in minutes.',
    subtitle: 'Brazil → Haiti and beyond. Low fees, real-time, secure.',
    getStarted: 'Get started',
    haveAccount: 'I already have an account',
  },
  auth: {
    phoneTitle: 'Enter your phone',
    phoneSubtitle: 'We will text you a 6-digit code.',
    phoneLabel: 'Phone number',
    sendCode: 'Send code',
    codeTitle: 'Enter the code',
    codeSubtitle: 'Sent to {phone}',
    codeLabel: 'Verification code',
    verify: 'Verify',
    resend: 'Resend code',
    signOut: 'Sign out',
    invalidCode: 'Invalid or expired code',
    rateLimited: 'Too many requests. Try again later.',
  },
  tabs: {
    home: 'Home', send: 'Send', activity: 'Activity', profile: 'Profile',
    cashier: 'Cashier', float: 'Float',
  },
  home: {
    greeting: 'Welcome back',
    totalBalance: 'Total balance',
    send: 'Send', receive: 'Receive', topup: 'Top-up', usdt: 'USDT',
    recent: 'Recent activity', seeAll: 'See all', empty: 'No transactions yet',
  },
  profile: { language: 'Language', theme: 'Appearance', security: 'Security', kyc: 'Verification', level: 'Level', logout: 'Log out' },
  agent: {
    title: 'Cashier', cashIn: 'Cash in', cashOut: 'Cash out',
    floatBalance: 'Float balance', commissions: 'Commissions', customers: 'Customers', empty: 'No operations yet',
  },
};

// Note: `en` is intentionally NOT `as const` — Dictionary must have `string`
// (not string-literal) leaves so PT/FR translations are assignable to it. The
// `Paths` type for t() keys still works because object keys are always literal.
export type Dictionary = typeof en;

export const pt: Dictionary = {
  common: { appName: 'Ticash Pay', continue: 'Continuar', cancel: 'Cancelar', back: 'Voltar', retry: 'Tentar de novo', loading: 'Carregando…', error: 'Algo deu errado' },
  onboarding: {
    title: 'Envie dinheiro para casa, em minutos.',
    subtitle: 'Brasil → Haiti e além. Taxas baixas, em tempo real, seguro.',
    getStarted: 'Começar',
    haveAccount: 'Já tenho uma conta',
  },
  auth: {
    phoneTitle: 'Digite seu telefone',
    phoneSubtitle: 'Vamos enviar um código de 6 dígitos por SMS.',
    phoneLabel: 'Número de telefone',
    sendCode: 'Enviar código',
    codeTitle: 'Digite o código',
    codeSubtitle: 'Enviado para {phone}',
    codeLabel: 'Código de verificação',
    verify: 'Verificar',
    resend: 'Reenviar código',
    signOut: 'Sair',
    invalidCode: 'Código inválido ou expirado',
    rateLimited: 'Muitas tentativas. Tente mais tarde.',
  },
  tabs: {
    home: 'Início', send: 'Enviar', activity: 'Atividade', profile: 'Perfil',
    cashier: 'Caixa', float: 'Saldo',
  },
  home: {
    greeting: 'Bem-vindo de volta',
    totalBalance: 'Saldo total',
    send: 'Enviar', receive: 'Receber', topup: 'Recarga', usdt: 'USDT',
    recent: 'Atividade recente', seeAll: 'Ver tudo', empty: 'Nenhuma transação ainda',
  },
  profile: { language: 'Idioma', theme: 'Aparência', security: 'Segurança', kyc: 'Verificação', level: 'Nível', logout: 'Sair' },
  agent: {
    title: 'Caixa', cashIn: 'Depósito', cashOut: 'Saque',
    floatBalance: 'Saldo de caixa', commissions: 'Comissões', customers: 'Clientes', empty: 'Nenhuma operação ainda',
  },
};

export const fr: Dictionary = {
  common: { appName: 'Ticash Pay', continue: 'Continuer', cancel: 'Annuler', back: 'Retour', retry: 'Réessayer', loading: 'Chargement…', error: 'Une erreur est survenue' },
  onboarding: {
    title: 'Envoyez de l’argent au pays, en quelques minutes.',
    subtitle: 'Brésil → Haïti et au-delà. Frais réduits, en temps réel, sécurisé.',
    getStarted: 'Commencer',
    haveAccount: 'J’ai déjà un compte',
  },
  auth: {
    phoneTitle: 'Entrez votre téléphone',
    phoneSubtitle: 'Nous vous enverrons un code à 6 chiffres par SMS.',
    phoneLabel: 'Numéro de téléphone',
    sendCode: 'Envoyer le code',
    codeTitle: 'Entrez le code',
    codeSubtitle: 'Envoyé au {phone}',
    codeLabel: 'Code de vérification',
    verify: 'Vérifier',
    resend: 'Renvoyer le code',
    signOut: 'Se déconnecter',
    invalidCode: 'Code invalide ou expiré',
    rateLimited: 'Trop de tentatives. Réessayez plus tard.',
  },
  tabs: {
    home: 'Accueil', send: 'Envoyer', activity: 'Activité', profile: 'Profil',
    cashier: 'Caisse', float: 'Solde',
  },
  home: {
    greeting: 'Bon retour',
    totalBalance: 'Solde total',
    send: 'Envoyer', receive: 'Recevoir', topup: 'Recharge', usdt: 'USDT',
    recent: 'Activité récente', seeAll: 'Tout voir', empty: 'Aucune transaction',
  },
  profile: { language: 'Langue', theme: 'Apparence', security: 'Sécurité', kyc: 'Vérification', level: 'Niveau', logout: 'Se déconnecter' },
  agent: {
    title: 'Caisse', cashIn: 'Dépôt', cashOut: 'Retrait',
    floatBalance: 'Solde de caisse', commissions: 'Commissions', customers: 'Clients', empty: 'Aucune opération' ,
  },
};

export const dictionaries = { en, pt, fr } as const;
export type Locale = keyof typeof dictionaries;
export const LOCALES: Locale[] = ['pt', 'fr', 'en'];
export const LOCALE_LABEL: Record<Locale, string> = { pt: 'Português', fr: 'Français', en: 'English' };
