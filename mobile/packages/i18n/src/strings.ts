/** Ticash Pay copy. EN is the source of truth for the shape; PT/FR must match it. */
export const en = {
  common: { appName: 'Ticash Pay', continue: 'Continue', cancel: 'Cancel', back: 'Back', retry: 'Retry', loading: 'Loading…', error: 'Something went wrong', optional: 'optional' },
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
    createAccount: 'Create account', signIn: 'Sign in', haveAccount: 'I already have an account',
    signupTitle: 'Create your account', signupSubtitle: 'A few details and you are ready.',
    name: 'Full name', namePlaceholder: 'Your full name', country: 'Country', email: 'Email',
    password: 'Password', passwordHint: 'At least 6 characters', newPassword: 'New password',
    loginTitle: 'Welcome back', loginSubtitle: 'Sign in with your email or phone.',
    handle: 'Email or phone', handlePlaceholder: 'email or +55…',
    forgot: 'Forgot password?', forgotSubtitle: 'Enter your phone to receive a code.', codeSent: 'Code sent',
    resetTitle: 'New password', resetPassword: 'Reset password',
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
    send: 'Send', deposit: 'Add', receive: 'Receive', topup: 'Top-up', usdt: 'USDT',
    recent: 'Recent activity', seeAll: 'See all', empty: 'No transactions yet',
  },
  deposit: {
    title: 'Add balance', subtitle: 'Add money to your wallet instantly with PIX.',
    amount: 'Amount (BRL)', name: 'Full name', namePlaceholder: 'Your full name', cpf: 'CPF',
    generate: 'Generate PIX code',
    payTitle: 'Pay with PIX', paySubtitle: 'Scan the QR code or copy the code in your bank app.',
    copyCode: 'PIX copy-and-paste code', waiting: 'Your balance updates automatically once the payment is confirmed.',
    refresh: 'Refresh balance', hint: 'PIX is instant — your balance appears as soon as we confirm the payment.',
  },
  profile: { language: 'Language', theme: 'Appearance', security: 'Security', kyc: 'Verification', level: 'Level', logout: 'Log out' },
  agent: {
    title: 'Cashier', cashIn: 'Cash in', cashOut: 'Cash out',
    floatBalance: 'Float balance', commissions: 'Commissions', customers: 'Customers', empty: 'No operations yet',
    lookupPhone: 'Customer phone', findCustomer: 'Find customer', amount: 'Amount', confirm: 'Confirm',
    done: 'Done!', noCustomer: 'No customer with that phone', earned: 'Earned',
  },
  send: {
    title: 'Send', destination: 'Destination', youSend: 'You send', recipient: 'Recipient number',
    recipientName: 'Recipient name', recipientNamePlaceholder: 'Full name', rail: 'How they receive',
    rate: 'Exchange rate', fee: 'Fee', youPay: 'You pay', recipientGets: 'Recipient gets',
    enterAmount: 'Enter an amount to see the quote', noRate: 'No rate for this corridor',
    sent: 'Sent!', toRecipient: 'to {recipient}',
  },
  activity: {
    send: 'Sent', deposit: 'Deposit', cashIn: 'Cash in', cashOut: 'Cash out', topup: 'Top-up', payout: 'Payout', reversal: 'Reversal',
    completed: 'Completed', processing: 'Processing',
  },
  receive: {
    title: 'Receive', subtitle: 'Share your details to get paid', yourAccount: 'Your account', copied: 'Copied',
  },
  topup: {
    title: 'Top-up', country: 'Country', phone: 'Phone to recharge', product: 'Product',
    pay: 'Pay', done: 'Recharge sent!', empty: 'No products available', selectCountry: 'Pick a country',
  },
  kyc: {
    title: 'Verification', status: 'Status', limits: 'Transaction limits', start: 'Verify my identity',
    perTx: 'per transaction', started: 'Verification started', pending: 'Pending', approved: 'Approved',
    rejected: 'Rejected', review: 'In review',
  },
};

// Note: `en` is intentionally NOT `as const` — Dictionary must have `string`
// (not string-literal) leaves so PT/FR translations are assignable to it. The
// `Paths` type for t() keys still works because object keys are always literal.
export type Dictionary = typeof en;

export const pt: Dictionary = {
  common: { appName: 'Ticash Pay', continue: 'Continuar', cancel: 'Cancelar', back: 'Voltar', retry: 'Tentar de novo', loading: 'Carregando…', error: 'Algo deu errado', optional: 'opcional' },
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
    createAccount: 'Criar conta', signIn: 'Entrar', haveAccount: 'Já tenho uma conta',
    signupTitle: 'Crie sua conta', signupSubtitle: 'Alguns dados e pronto.',
    name: 'Nome completo', namePlaceholder: 'Seu nome completo', country: 'País', email: 'E-mail',
    password: 'Senha', passwordHint: 'Pelo menos 6 caracteres', newPassword: 'Nova senha',
    loginTitle: 'Bem-vindo de volta', loginSubtitle: 'Entre com seu e-mail ou telefone.',
    handle: 'E-mail ou telefone', handlePlaceholder: 'e-mail ou +55…',
    forgot: 'Esqueceu a senha?', forgotSubtitle: 'Digite seu telefone para receber um código.', codeSent: 'Código enviado',
    resetTitle: 'Nova senha', resetPassword: 'Redefinir senha',
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
    send: 'Enviar', deposit: 'Adicionar', receive: 'Receber', topup: 'Recarga', usdt: 'USDT',
    recent: 'Atividade recente', seeAll: 'Ver tudo', empty: 'Nenhuma transação ainda',
  },
  deposit: {
    title: 'Adicionar saldo', subtitle: 'Coloque dinheiro na sua carteira na hora, com PIX.',
    amount: 'Valor (BRL)', name: 'Nome completo', namePlaceholder: 'Seu nome completo', cpf: 'CPF',
    generate: 'Gerar código PIX',
    payTitle: 'Pague com PIX', paySubtitle: 'Escaneie o QR code ou copie o código no app do seu banco.',
    copyCode: 'Código PIX copia e cola', waiting: 'Seu saldo é atualizado automaticamente assim que o pagamento for confirmado.',
    refresh: 'Atualizar saldo', hint: 'O PIX é instantâneo — seu saldo aparece assim que confirmarmos o pagamento.',
  },
  profile: { language: 'Idioma', theme: 'Aparência', security: 'Segurança', kyc: 'Verificação', level: 'Nível', logout: 'Sair' },
  agent: {
    title: 'Caixa', cashIn: 'Depósito', cashOut: 'Saque',
    floatBalance: 'Saldo de caixa', commissions: 'Comissões', customers: 'Clientes', empty: 'Nenhuma operação ainda',
    lookupPhone: 'Telefone do cliente', findCustomer: 'Buscar cliente', amount: 'Valor', confirm: 'Confirmar',
    done: 'Pronto!', noCustomer: 'Nenhum cliente com esse telefone', earned: 'Ganho',
  },
  send: {
    title: 'Enviar', destination: 'Destino', youSend: 'Você envia', recipient: 'Número do destinatário',
    recipientName: 'Nome do destinatário', recipientNamePlaceholder: 'Nome completo', rail: 'Como recebe',
    rate: 'Taxa de câmbio', fee: 'Taxa', youPay: 'Você paga', recipientGets: 'Destinatário recebe',
    enterAmount: 'Digite um valor para ver a cotação', noRate: 'Sem cotação para este trajeto',
    sent: 'Enviado!', toRecipient: 'para {recipient}',
  },
  activity: {
    send: 'Enviado', deposit: 'Depósito', cashIn: 'Depósito (agente)', cashOut: 'Saque', topup: 'Recarga', payout: 'Pagamento', reversal: 'Estorno',
    completed: 'Concluído', processing: 'Processando',
  },
  receive: {
    title: 'Receber', subtitle: 'Compartilhe seus dados para receber', yourAccount: 'Sua conta', copied: 'Copiado',
  },
  topup: {
    title: 'Recarga', country: 'País', phone: 'Telefone para recarregar', product: 'Produto',
    pay: 'Pagar', done: 'Recarga enviada!', empty: 'Nenhum produto disponível', selectCountry: 'Escolha um país',
  },
  kyc: {
    title: 'Verificação', status: 'Status', limits: 'Limites de transação', start: 'Verificar minha identidade',
    perTx: 'por transação', started: 'Verificação iniciada', pending: 'Pendente', approved: 'Aprovado',
    rejected: 'Rejeitado', review: 'Em análise',
  },
};

export const fr: Dictionary = {
  common: { appName: 'Ticash Pay', continue: 'Continuer', cancel: 'Annuler', back: 'Retour', retry: 'Réessayer', loading: 'Chargement…', error: 'Une erreur est survenue', optional: 'optionnel' },
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
    createAccount: 'Créer un compte', signIn: 'Se connecter', haveAccount: 'J’ai déjà un compte',
    signupTitle: 'Créez votre compte', signupSubtitle: 'Quelques infos et c’est prêt.',
    name: 'Nom complet', namePlaceholder: 'Votre nom complet', country: 'Pays', email: 'E-mail',
    password: 'Mot de passe', passwordHint: 'Au moins 6 caractères', newPassword: 'Nouveau mot de passe',
    loginTitle: 'Bon retour', loginSubtitle: 'Connectez-vous avec e-mail ou téléphone.',
    handle: 'E-mail ou téléphone', handlePlaceholder: 'e-mail ou +55…',
    forgot: 'Mot de passe oublié ?', forgotSubtitle: 'Entrez votre téléphone pour recevoir un code.', codeSent: 'Code envoyé',
    resetTitle: 'Nouveau mot de passe', resetPassword: 'Réinitialiser',
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
    send: 'Envoyer', deposit: 'Ajouter', receive: 'Recevoir', topup: 'Recharge', usdt: 'USDT',
    recent: 'Activité récente', seeAll: 'Tout voir', empty: 'Aucune transaction',
  },
  deposit: {
    title: 'Ajouter du solde', subtitle: 'Ajoutez de l’argent à votre portefeuille instantanément avec PIX.',
    amount: 'Montant (BRL)', name: 'Nom complet', namePlaceholder: 'Votre nom complet', cpf: 'CPF',
    generate: 'Générer le code PIX',
    payTitle: 'Payer avec PIX', paySubtitle: 'Scannez le QR code ou copiez le code dans votre application bancaire.',
    copyCode: 'Code PIX copier-coller', waiting: 'Votre solde est mis à jour automatiquement dès que le paiement est confirmé.',
    refresh: 'Actualiser le solde', hint: 'PIX est instantané — votre solde apparaît dès que nous confirmons le paiement.',
  },
  profile: { language: 'Langue', theme: 'Apparence', security: 'Sécurité', kyc: 'Vérification', level: 'Niveau', logout: 'Se déconnecter' },
  agent: {
    title: 'Caisse', cashIn: 'Dépôt', cashOut: 'Retrait',
    floatBalance: 'Solde de caisse', commissions: 'Commissions', customers: 'Clients', empty: 'Aucune opération' ,
    lookupPhone: 'Téléphone du client', findCustomer: 'Trouver le client', amount: 'Montant', confirm: 'Confirmer',
    done: 'Terminé !', noCustomer: 'Aucun client avec ce numéro', earned: 'Gagné',
  },
  send: {
    title: 'Envoyer', destination: 'Destination', youSend: 'Vous envoyez', recipient: 'Numéro du destinataire',
    recipientName: 'Nom du destinataire', recipientNamePlaceholder: 'Nom complet', rail: 'Mode de réception',
    rate: 'Taux de change', fee: 'Frais', youPay: 'Vous payez', recipientGets: 'Le destinataire reçoit',
    enterAmount: 'Saisissez un montant pour voir le devis', noRate: 'Aucun taux pour ce corridor',
    sent: 'Envoyé !', toRecipient: 'à {recipient}',
  },
  activity: {
    send: 'Envoyé', deposit: 'Dépôt', cashIn: 'Dépôt (agent)', cashOut: 'Retrait', topup: 'Recharge', payout: 'Paiement', reversal: 'Remboursement',
    completed: 'Terminé', processing: 'En cours',
  },
  receive: {
    title: 'Recevoir', subtitle: 'Partagez vos coordonnées pour être payé', yourAccount: 'Votre compte', copied: 'Copié',
  },
  topup: {
    title: 'Recharge', country: 'Pays', phone: 'Téléphone à recharger', product: 'Produit',
    pay: 'Payer', done: 'Recharge envoyée !', empty: 'Aucun produit disponible', selectCountry: 'Choisissez un pays',
  },
  kyc: {
    title: 'Vérification', status: 'Statut', limits: 'Limites de transaction', start: 'Vérifier mon identité',
    perTx: 'par transaction', started: 'Vérification lancée', pending: 'En attente', approved: 'Approuvé',
    rejected: 'Rejeté', review: 'En cours',
  },
};

export const dictionaries = { en, pt, fr } as const;
export type Locale = keyof typeof dictionaries;
export const LOCALES: Locale[] = ['pt', 'fr', 'en'];
export const LOCALE_LABEL: Record<Locale, string> = { pt: 'Português', fr: 'Français', en: 'English' };
