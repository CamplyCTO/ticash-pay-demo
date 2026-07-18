import React, { useState } from 'react';
import { Image, Pressable, View } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import * as ImageManipulator from 'expo-image-manipulator';
import { Ionicons } from '@expo/vector-icons';
import { Button, Card, Divider, EmptyState, Input, Row, Screen, Text, useTheme, useToast } from '@ticash/ui';
import { formatMoneyParts, type Currency, type P2POffer, type P2POrder, type P2PPaymentMethod } from '@ticash/api-client';
import {
  messageForError,
  useOpenP2POrder,
  useP2POffers,
  useMyP2POffers,
  useCreateP2POffer,
  useCloseP2POffer,
  useP2POrders,
  useP2PPay,
  useP2PProofImage,
  useReleaseP2POrder,
  useDisputeP2POrder,
  useCancelP2POrder,
  useUsdtDeposit,
} from '@ticash/core';
import { useI18n } from '@ticash/i18n';

// Payment methods a seller can accept (expandable). Jean's set: PIX / MonCash /
// NatCash / Zelle / bank transfer.
const METHOD_OPTIONS: { type: string; label: string }[] = [
  { type: 'pix', label: 'PIX' },
  { type: 'moncash', label: 'MonCash' },
  { type: 'natcash', label: 'NatCash' },
  { type: 'zelle', label: 'Zelle' },
  { type: 'bank', label: 'Transferência bancária' },
];
// Fiat currencies a seller can price/receive in (one per offer).
const FIATS: Currency[] = ['BRL', 'HTG', 'USD', 'MXN', 'DOP'];

// NOTE: this WS-4 MVP screen uses literal PT copy (the primary market). FR/EN
// i18n keys + image-picker proof upload are a documented follow-up.

const money = (minor: string, ccy: 'USDT' | string) => {
  const p = formatMoneyParts(minor, ccy as never);
  const frac = ccy === 'USDT' ? p.fraction.slice(0, 2) : p.fraction;
  return `${p.symbol}${p.integer},${frac}`;
};

/** Human "min – max" per-order limit line for an offer (null when unlimited). */
const limitsLabel = (o: P2POffer): string | null => {
  const lo = o.minFiatMinor ? money(o.minFiatMinor, o.fiatCurrency) : null;
  const hi = o.maxFiatMinor ? money(o.maxFiatMinor, o.fiatCurrency) : null;
  if (lo && hi) return `Limite ${lo} – ${hi} ${o.fiatCurrency}`;
  if (lo) return `Mín. ${lo} ${o.fiatCurrency}`;
  if (hi) return `Máx. ${hi} ${o.fiatCurrency}`;
  return null;
};

const STATUS_LABEL: Record<P2POrder['status'], string> = {
  created: 'Aguardando seu pagamento',
  payment_submitted: 'Aguardando o vendedor confirmar',
  released: 'Concluída — USDT recebido',
  cancelled: 'Cancelada',
  disputed: 'Em análise (central)',
};

type UsdtTab = 'buy' | 'sell' | 'deposit' | 'orders';
const TAB_LABEL: Record<UsdtTab, string> = { buy: 'Comprar', sell: 'Vender', deposit: 'Depositar', orders: 'Ordens' };

export function UsdtScreen() {
  const t = useTheme();
  const [tab, setTab] = useState<UsdtTab>('buy');

  return (
    <Screen scroll>
      <Text variant="title" style={{ marginTop: t.spacing(3), marginBottom: t.spacing(4) }}>USDT</Text>
      <Row gap={2} style={{ marginBottom: t.spacing(4) }}>
        {(['buy', 'sell', 'deposit', 'orders'] as const).map((k) => {
          const active = k === tab;
          return (
            <Pressable key={k} onPress={() => setTab(k)} style={{ flex: 1, alignItems: 'center', paddingVertical: t.spacing(2.5), borderRadius: t.radius.pill, backgroundColor: active ? t.colors.primary : t.colors.surface, borderWidth: 1, borderColor: active ? t.colors.primary : t.colors.border }}>
              <Text variant="caption" weight="semibold" style={{ color: active ? t.colors.onPrimary : t.colors.text }}>{TAB_LABEL[k]}</Text>
            </Pressable>
          );
        })}
      </Row>
      {tab === 'buy' ? <BuyTab /> : tab === 'sell' ? <SellTab /> : tab === 'deposit' ? <DepositTab /> : <OrdersTab />}
    </Screen>
  );
}

function BuyTab() {
  const t = useTheme();
  const toast = useToast();
  const { t: tr } = useI18n();
  const offers = useP2POffers();
  const [selected, setSelected] = useState<P2POffer | null>(null);

  if (selected) return <BuyForm offer={selected} onDone={() => setSelected(null)} />;

  const active = (offers.data ?? []).filter((o) => o.status === 'active' && BigInt(o.remainingMinor) > 0n);
  if (offers.isLoading) return <Text variant="body" color="textMuted" center>{tr('common.loading')}</Text>;
  if (!active.length) return <EmptyState title="Nenhuma oferta de USDT disponível" icon={<Ionicons name="logo-usd" size={26} color={t.colors.primary} />} />;

  return (
    <View style={{ gap: t.spacing(3) }}>
      {active.map((o) => (
        <Card key={o.id}>
          <Row style={{ justifyContent: 'space-between' }}>
            <View style={{ flex: 1, paddingRight: t.spacing(2) }}>
              <Text variant="body" weight="bold">{`${o.pricePerUnit} ${o.fiatCurrency} / USDT`}</Text>
              <Text variant="caption" color="textMuted">{`Disponível: ${money(o.remainingMinor, 'USDT')} USDT`}</Text>
              {limitsLabel(o) ? <Text variant="caption" color="textMuted">{limitsLabel(o)}</Text> : null}
              <Text variant="caption" color="textMuted">{`${o.methods.map((m) => m.label).join(' · ')} · pague em ${o.payWindowMin} min`}</Text>
            </View>
            <Button title="Comprar" onPress={() => setSelected(o)} />
          </Row>
        </Card>
      ))}
    </View>
  );
}

function BuyForm({ offer, onDone }: { offer: P2POffer; onDone: () => void }) {
  const t = useTheme();
  const toast = useToast();
  const { t: tr } = useI18n();
  const [amount, setAmount] = useState('');
  const [order, setOrder] = useState<P2POrder | null>(null);
  const [proof, setProof] = useState('');
  const [photo, setPhoto] = useState<{ base64: string; uri: string } | null>(null);
  const [methodType, setMethodType] = useState<string>(offer.methods[0]?.type ?? '');
  const open = useOpenP2POrder();
  const pay = useP2PPay();

  const amountNum = Number(amount);
  const estFiat = amountNum > 0 ? (amountNum * Number(offer.pricePerUnit)).toFixed(2) : '0.00';

  const pickPhoto = async () => {
    const res = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ImagePicker.MediaTypeOptions.Images, quality: 0.7 });
    if (res.canceled || !res.assets?.[0]) return;
    // Resize + compress so the upload stays small (a screenshot is plenty at 1000px/60%).
    const m = await ImageManipulator.manipulateAsync(res.assets[0].uri, [{ resize: { width: 1000 } }], { compress: 0.6, format: ImageManipulator.SaveFormat.JPEG, base64: true });
    if (m.base64) setPhoto({ base64: m.base64, uri: m.uri });
  };

  if (order) {
    const canConfirm = (proof.trim().length >= 3 || !!photo) && !pay.isPending;
    // Payment instructions + proof submission (text and/or photo).
    return (
      <Screen scroll footer={<Button title="Confirmar pagamento" disabled={!canConfirm} loading={pay.isPending} onPress={() => {
        pay.mutate({ id: order.id, proofRef: proof.trim() || undefined, image: photo?.base64, contentType: photo ? 'image/jpeg' : undefined }, {
          onSuccess: () => { toast.success('Pagamento informado — aguarde a confirmação do vendedor'); onDone(); },
          onError: (e) => toast.error(messageForError(e, tr)),
        });
      }} />}>
        <Text variant="title" style={{ marginVertical: t.spacing(3) }}>Pague ao vendedor</Text>
        <Card>
          <Line label="Você recebe" value={`${money(order.netToBuyerMinor, 'USDT')} USDT`} strong />
          <Line label="Você paga" value={`${money(order.fiatMinor, order.fiatCurrency)} ${order.fiatCurrency}`} />
          <Divider spacing={1} />
          <Line label="Método" value={order.method.label} />
          <View style={{ marginTop: t.spacing(2) }}>
            <Text variant="caption" color="textMuted" style={{ marginBottom: t.spacing(1) }}>Número / conta para pagar</Text>
            <View style={{ borderWidth: 1, borderColor: t.colors.primary, borderRadius: t.radius.md, padding: t.spacing(3), backgroundColor: t.colors.primarySoft }}>
              <Text selectable variant="heading" style={{ fontSize: 20 }}>{order.method.account}</Text>
            </View>
          </View>
        </Card>
        <Text variant="caption" color="textMuted" style={{ marginVertical: t.spacing(3) }}>
          {`Envie ${money(order.fiatMinor, order.fiatCurrency)} ${order.fiatCurrency} para a conta ${order.method.label} acima. Anexe uma foto do comprovante (ou informe o link/ID). O vendedor confere e libera o USDT.`}
        </Text>
        {/* Photo of the payment (screenshot) — the primary proof for most users */}
        {photo ? (
          <View style={{ marginBottom: t.spacing(3) }}>
            <Image source={{ uri: photo.uri }} style={{ width: '100%', height: 220, borderRadius: t.radius.md }} resizeMode="contain" />
            <Button title="Trocar foto" variant="ghost" onPress={pickPhoto} style={{ marginTop: t.spacing(1) }} />
          </View>
        ) : (
          <Button title="Anexar foto do comprovante" variant="secondary" onPress={pickPhoto} left={<Ionicons name="camera-outline" size={18} color={t.colors.text} />} style={{ marginBottom: t.spacing(3) }} />
        )}
        <Input label="Comprovante (link ou ID) — opcional" value={proof} onChangeText={setProof} placeholder="https://... ou nº da transação" />
      </Screen>
    );
  }

  return (
    <Screen scroll footer={<Button title="Abrir ordem" disabled={amountNum <= 0 || !methodType || open.isPending} loading={open.isPending} onPress={() => {
      open.mutate({ offerId: offer.id, amount: amount.trim(), methodType }, {
        onSuccess: (o) => setOrder(o),
        onError: (e) => toast.error(messageForError(e, tr)),
      });
    }} />}>
      <Pressable onPress={onDone} style={{ marginVertical: t.spacing(3) }}><Text color="primary">‹ Voltar</Text></Pressable>
      <Text variant="title" style={{ marginBottom: t.spacing(3) }}>Comprar USDT</Text>
      <Card style={{ marginBottom: t.spacing(4) }}>
        <Line label="Preço" value={`${offer.pricePerUnit} ${offer.fiatCurrency} / USDT`} />
        <Line label="Disponível" value={`${money(offer.remainingMinor, 'USDT')} USDT`} />
        {limitsLabel(offer) ? <Line label="Limite" value={limitsLabel(offer) as string} /> : null}
        <Line label="Prazo p/ pagar" value={`${offer.payWindowMin} min`} />
      </Card>
      <Text variant="label" color="textMuted" style={{ marginBottom: t.spacing(2) }}>Como você vai pagar</Text>
      <Row gap={2} style={{ flexWrap: 'wrap', marginBottom: t.spacing(4) }}>
        {offer.methods.map((m) => {
          const activeM = m.type === methodType;
          return (
            <Pressable key={m.type} onPress={() => setMethodType(m.type)} style={{ paddingHorizontal: t.spacing(3.5), paddingVertical: t.spacing(2.5), borderRadius: t.radius.pill, backgroundColor: activeM ? t.colors.primary : t.colors.surface, borderWidth: 1, borderColor: activeM ? t.colors.primary : t.colors.border }}>
              <Text variant="label" weight="semibold" style={{ color: activeM ? t.colors.onPrimary : t.colors.text }}>{m.label}</Text>
            </Pressable>
          );
        })}
      </Row>
      <Text variant="caption" color="textMuted" style={{ marginBottom: t.spacing(4) }}>O número/conta do vendedor aparece na próxima tela, depois de abrir a ordem.</Text>
      <Input label="Quanto de USDT" value={amount} onChangeText={(v) => setAmount(v.replace(/[^0-9.]/g, '').replace(/(\..*)\./g, '$1'))} keyboardType="decimal-pad" placeholder="0.00" />
      <Card style={{ marginTop: t.spacing(4) }}>
        <Line label="Você paga (aprox.)" value={`${estFiat} ${offer.fiatCurrency}`} strong />
      </Card>
    </Screen>
  );
}

const SELLER_STATUS: Record<P2POrder['status'], string> = {
  created: 'Aguardando o comprador pagar',
  payment_submitted: 'Pago — confira e libere o USDT',
  released: 'Concluída — USDT liberado',
  cancelled: 'Cancelada',
  disputed: 'Em disputa (central)',
};

function OrdersTab() {
  const t = useTheme();
  const [role, setRole] = useState<'buyer' | 'seller'>('buyer');
  return (
    <View style={{ gap: t.spacing(3) }}>
      <Row gap={2}>
        {(['buyer', 'seller'] as const).map((k) => {
          const active = k === role;
          return (
            <Pressable key={k} onPress={() => setRole(k)} style={{ flex: 1, alignItems: 'center', paddingVertical: t.spacing(2), borderRadius: t.radius.pill, backgroundColor: active ? t.colors.primary : t.colors.surface, borderWidth: 1, borderColor: active ? t.colors.primary : t.colors.border }}>
              <Text variant="label" weight="semibold" style={{ color: active ? t.colors.onPrimary : t.colors.text }}>{k === 'buyer' ? 'Compras' : 'Vendas'}</Text>
            </Pressable>
          );
        })}
      </Row>
      {role === 'buyer' ? <BuyerOrders /> : <SellerOrders />}
    </View>
  );
}

function BuyerOrders() {
  const t = useTheme();
  const toast = useToast();
  const { t: tr } = useI18n();
  const orders = useP2POrders('buyer');
  const cancel = useCancelP2POrder();
  const dispute = useDisputeP2POrder();
  if (orders.isLoading) return <Text variant="body" color="textMuted" center>{tr('common.loading')}</Text>;
  const rows = orders.data ?? [];
  if (!rows.length) return <EmptyState title="Você ainda não tem compras" icon={<Ionicons name="receipt-outline" size={26} color={t.colors.primary} />} />;
  return (
    <View style={{ gap: t.spacing(3) }}>
      {rows.map((o) => (
        <Card key={o.id}>
          <Row style={{ justifyContent: 'space-between' }}>
            <View style={{ flex: 1 }}>
              <Text variant="body" weight="bold">{`${money(o.netToBuyerMinor, 'USDT')} USDT`}</Text>
              <Text variant="caption" color="textMuted">{STATUS_LABEL[o.status]}</Text>
            </View>
            {o.status === 'created' && (
              <Button variant="ghost" title="Cancelar" onPress={() => cancel.mutate(o.id, { onError: (e) => toast.error(messageForError(e, tr)) })} />
            )}
            {o.status === 'payment_submitted' && (
              <Button variant="ghost" title="Abrir disputa" onPress={() => dispute.mutate({ id: o.id, reason: 'Paguei mas não recebi o USDT' }, { onSuccess: () => toast.success('Disputa aberta — a central vai analisar'), onError: (e) => toast.error(messageForError(e, tr)) })} />
            )}
          </Row>
        </Card>
      ))}
    </View>
  );
}

// Seller side: see orders against your offers, check the buyer's proof, and RELEASE
// the USDT (the answer to "como o vendedor libera o USDT").
function SellerOrders() {
  const t = useTheme();
  const toast = useToast();
  const { t: tr } = useI18n();
  const orders = useP2POrders('seller');
  const release = useReleaseP2POrder();
  const cancel = useCancelP2POrder();
  if (orders.isLoading) return <Text variant="body" color="textMuted" center>{tr('common.loading')}</Text>;
  const rows = orders.data ?? [];
  if (!rows.length) return <EmptyState title="Nenhuma venda ainda" icon={<Ionicons name="cash-outline" size={26} color={t.colors.primary} />} />;
  const busy = release.isPending || cancel.isPending;
  return (
    <View style={{ gap: t.spacing(3) }}>
      {rows.map((o) => (
        <Card key={o.id} style={{ gap: t.spacing(2) }}>
          <View>
            <Text variant="body" weight="bold">{`${money(o.assetMinor, 'USDT')} USDT`}</Text>
            <Text variant="caption" color="textMuted">{`Recebe ${money(o.fiatMinor, o.fiatCurrency)} ${o.fiatCurrency} · ${o.method.label}`}</Text>
            <Text variant="caption" color={o.status === 'payment_submitted' ? 'primary' : 'textMuted'}>{SELLER_STATUS[o.status]}</Text>
          </View>
          {o.status === 'payment_submitted' ? (
            <>
              {o.proofRef ? (
                <View style={{ borderWidth: 1, borderColor: t.colors.divider, borderRadius: t.radius.md, padding: t.spacing(2.5) }}>
                  <Text variant="caption" color="textMuted">Comprovante do comprador</Text>
                  <Text selectable variant="caption">{o.proofRef}</Text>
                </View>
              ) : null}
              <ProofImage orderId={o.id} />
              <Row gap={3}>
                <Button variant="secondary" title="Rejeitar" style={{ flex: 1 }} disabled={busy} onPress={() => cancel.mutate(o.id, { onSuccess: () => toast.success('Ordem rejeitada'), onError: (e) => toast.error(messageForError(e, tr)) })} />
                <Button title="Liberar USDT" style={{ flex: 1 }} loading={release.isPending} disabled={busy} onPress={() => release.mutate(o.id, { onSuccess: () => toast.success('USDT liberado ao comprador'), onError: (e) => toast.error(messageForError(e, tr)) })} />
              </Row>
            </>
          ) : null}
        </Card>
      ))}
    </View>
  );
}

// ---- Sell: seller lists USDT + configures the offer ----------------------
function SellTab() {
  const t = useTheme();
  const toast = useToast();
  const { t: tr } = useI18n();
  const myOffers = useMyP2POffers();
  const close = useCloseP2POffer();
  const [creating, setCreating] = useState(false);

  if (creating) return <SellForm onDone={() => setCreating(false)} />;

  const offers = (myOffers.data ?? []).filter((o) => o.status === 'active');
  return (
    <View style={{ gap: t.spacing(3) }}>
      <Button title="+ Criar anúncio de venda" onPress={() => setCreating(true)} />
      {myOffers.isLoading ? (
        <Text variant="body" color="textMuted" center>{tr('common.loading')}</Text>
      ) : offers.length === 0 ? (
        <EmptyState title="Você ainda não tem anúncios" icon={<Ionicons name="pricetag-outline" size={26} color={t.colors.primary} />} />
      ) : (
        offers.map((o) => (
          <Card key={o.id}>
            <Row style={{ justifyContent: 'space-between' }}>
              <View style={{ flex: 1, paddingRight: t.spacing(2) }}>
                <Text variant="body" weight="bold">{`${o.pricePerUnit} ${o.fiatCurrency} / USDT`}</Text>
                <Text variant="caption" color="textMuted">{`Restam ${money(o.remainingMinor, 'USDT')} USDT`}</Text>
                {limitsLabel(o) ? <Text variant="caption" color="textMuted">{limitsLabel(o)}</Text> : null}
                <Text variant="caption" color="textMuted">{`${o.methods.map((m) => m.label).join(' · ')} · ${o.payWindowMin} min`}</Text>
              </View>
              <Button variant="ghost" title="Encerrar" onPress={() => close.mutate(o.id, { onSuccess: () => toast.success('Anúncio encerrado — USDT devolvido'), onError: (e) => toast.error(messageForError(e, tr)) })} />
            </Row>
          </Card>
        ))
      )}
    </View>
  );
}

function SellForm({ onDone }: { onDone: () => void }) {
  const t = useTheme();
  const toast = useToast();
  const { t: tr } = useI18n();
  const create = useCreateP2POffer();

  const [amount, setAmount] = useState('');
  const [fiat, setFiat] = useState<Currency>('BRL');
  const [price, setPrice] = useState('');
  const [min, setMin] = useState('');
  const [max, setMax] = useState('');
  const [win, setWin] = useState('15');
  const [methods, setMethods] = useState<Record<string, string>>({}); // type -> account (key present = selected)

  const dec = (v: string) => v.replace(/[^0-9.]/g, '').replace(/(\..*)\./g, '$1');
  const toggle = (type: string) => setMethods((m) => { const n = { ...m }; if (type in n) delete n[type]; else n[type] = ''; return n; });
  const setAccount = (type: string, account: string) => setMethods((m) => ({ ...m, [type]: account }));

  const selectedMethods: P2PPaymentMethod[] = METHOD_OPTIONS
    .filter((o) => o.type in methods && methods[o.type].trim().length > 0)
    .map((o) => ({ type: o.type, label: o.label, account: methods[o.type].trim() }));

  const minN = Number(min || '0');
  const maxN = Number(max || '0');
  const valid =
    Number(amount) > 0 && Number(price) > 0 && selectedMethods.length > 0 &&
    Number(win) >= 1 && Number(win) <= 1440 &&
    (!(min && max) || minN <= maxN);

  const submit = () => {
    if (!valid || create.isPending) return;
    create.mutate(
      {
        fiatCurrency: fiat,
        pricePerUnit: price.trim(),
        amount: amount.trim(),
        ...(min.trim() ? { minAmount: min.trim() } : {}),
        ...(max.trim() ? { maxAmount: max.trim() } : {}),
        payWindowMin: Number(win),
        methods: selectedMethods,
      },
      { onSuccess: () => { toast.success('Anúncio publicado!'); onDone(); }, onError: (e) => toast.error(messageForError(e, tr)) },
    );
  };

  return (
    <View style={{ gap: t.spacing(4) }}>
      <Pressable onPress={onDone}><Text color="primary">‹ Voltar</Text></Pressable>
      <Text variant="subheading">Criar anúncio de venda</Text>

      <Input label="Quantidade de USDT" value={amount} onChangeText={(v) => setAmount(dec(v))} keyboardType="decimal-pad" placeholder="0.00" />

      <View>
        <Text variant="label" color="textMuted" style={{ marginBottom: t.spacing(2) }}>Moeda que você recebe</Text>
        <Row gap={2} style={{ flexWrap: 'wrap' }}>
          {FIATS.map((c) => {
            const active = c === fiat;
            return (
              <Pressable key={c} onPress={() => setFiat(c)} style={{ paddingHorizontal: t.spacing(3.5), paddingVertical: t.spacing(2.5), borderRadius: t.radius.pill, backgroundColor: active ? t.colors.primary : t.colors.surface, borderWidth: 1, borderColor: active ? t.colors.primary : t.colors.border }}>
                <Text variant="label" weight="semibold" style={{ color: active ? t.colors.onPrimary : t.colors.text }}>{c}</Text>
              </Pressable>
            );
          })}
        </Row>
      </View>

      <Input label={`Preço por USDT (${fiat})`} value={price} onChangeText={(v) => setPrice(dec(v))} keyboardType="decimal-pad" placeholder="0.00" />

      <Row gap={3}>
        <Input containerStyle={{ flex: 1 }} label={`Mín. (${fiat})`} value={min} onChangeText={(v) => setMin(dec(v))} keyboardType="decimal-pad" placeholder="opcional" />
        <Input containerStyle={{ flex: 1 }} label={`Máx. (${fiat})`} value={max} onChangeText={(v) => setMax(dec(v))} keyboardType="decimal-pad" placeholder="opcional" />
      </Row>

      <Input label="Tempo para o comprador pagar (min)" value={win} onChangeText={(v) => setWin(v.replace(/[^0-9]/g, ''))} keyboardType="number-pad" placeholder="15" />

      <View>
        <Text variant="label" color="textMuted" style={{ marginBottom: t.spacing(2) }}>Formas de pagamento aceitas</Text>
        <View style={{ gap: t.spacing(2) }}>
          {METHOD_OPTIONS.map((m) => {
            const on = m.type in methods;
            return (
              <View key={m.type}>
                <Pressable onPress={() => toggle(m.type)} style={{ flexDirection: 'row', alignItems: 'center', gap: t.spacing(2), paddingVertical: t.spacing(1) }}>
                  <View style={{ width: 22, height: 22, borderRadius: 6, borderWidth: 2, borderColor: on ? t.colors.primary : t.colors.border, backgroundColor: on ? t.colors.primary : 'transparent', alignItems: 'center', justifyContent: 'center' }}>
                    {on ? <Ionicons name="checkmark" size={15} color={t.colors.onPrimary} /> : null}
                  </View>
                  <Text variant="body" weight="semibold">{m.label}</Text>
                </Pressable>
                {on ? (
                  <Input value={methods[m.type]} onChangeText={(v) => setAccount(m.type, v)} placeholder={`Conta / chave ${m.label}`} containerStyle={{ marginTop: t.spacing(1), marginLeft: t.spacing(7) }} />
                ) : null}
              </View>
            );
          })}
        </View>
      </View>

      <Button title="Publicar anúncio" disabled={!valid} loading={create.isPending} onPress={submit} />
    </View>
  );
}

// ---- Deposit: on-ramp USDT from an external crypto wallet -----------------
function DepositTab() {
  const t = useTheme();
  const toast = useToast();
  const { t: tr } = useI18n();
  const deposit = useUsdtDeposit();
  const [amount, setAmount] = useState('');
  const [addr, setAddr] = useState<{ payAddress: string; payAmount: string; payCurrency: string } | null>(null);

  if (addr) {
    const net = addr.payCurrency.toUpperCase();
    return (
      <View style={{ gap: t.spacing(4) }}>
        <Pressable onPress={() => setAddr(null)}><Text color="primary">‹ Voltar</Text></Pressable>
        <Text variant="subheading">Envie USDT para este endereço</Text>
        <Card style={{ gap: t.spacing(3) }}>
          <View>
            <Text variant="caption" color="textMuted">Valor a enviar</Text>
            <Text variant="heading">{addr.payAmount} {net}</Text>
          </View>
          <View>
            <Text variant="caption" color="textMuted" style={{ marginBottom: t.spacing(1) }}>{`Endereço (${net})`}</Text>
            <View style={{ borderWidth: 1, borderColor: t.colors.divider, borderRadius: t.radius.md, padding: t.spacing(3) }}>
              <Text selectable variant="caption">{addr.payAddress}</Text>
            </View>
          </View>
        </Card>
        <Text variant="caption" color="textMuted">
          {`Envie exatamente esse valor de USDT (rede ${net}) da sua carteira/corretora para o endereço acima. Seu saldo USDT aparece assim que a rede confirmar.`}
        </Text>
        <Button title="Já enviei" variant="secondary" onPress={() => { toast.success('Assim que a rede confirmar, seu saldo USDT aparece.'); setAddr(null); }} />
      </View>
    );
  }

  return (
    <View style={{ gap: t.spacing(4) }}>
      <Text variant="body" color="textMuted">Adicione USDT à sua carteira Ticash a partir de uma carteira/corretora cripto (ex.: Binance). Depois você pode vender no P2P.</Text>
      <Input label="Quanto de USDT" value={amount} onChangeText={(v) => setAmount(v.replace(/[^0-9.]/g, '').replace(/(\..*)\./g, '$1'))} keyboardType="decimal-pad" placeholder="0.00" />
      <Button title="Gerar endereço de depósito" disabled={Number(amount) <= 0 || deposit.isPending} loading={deposit.isPending} onPress={() => {
        deposit.mutate(amount.trim(), {
          onSuccess: (r) => setAddr({ payAddress: r.payAddress, payAmount: r.payAmount, payCurrency: r.payCurrency }),
          onError: (e) => toast.error(messageForError(e, tr)),
        });
      }} />
    </View>
  );
}

/** Loads + shows the buyer's payment-proof photo for a seller's order (if any). */
function ProofImage({ orderId }: { orderId: string }) {
  const t = useTheme();
  const q = useP2PProofImage(orderId);
  if (q.isError || !q.data?.image) return null;
  return (
    <View>
      <Text variant="caption" color="textMuted" style={{ marginBottom: t.spacing(1) }}>Foto do comprovante</Text>
      <Image source={{ uri: `data:${q.data.contentType};base64,${q.data.image}` }} style={{ width: '100%', height: 220, borderRadius: t.radius.md }} resizeMode="contain" />
    </View>
  );
}

function Line({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  const t = useTheme();
  return (
    <Row style={{ justifyContent: 'space-between', paddingVertical: t.spacing(1.5) }}>
      <Text variant="body" color="textMuted">{label}</Text>
      <Text variant="body" weight={strong ? 'bold' : 'semibold'} color={strong ? 'primary' : 'text'}>{value}</Text>
    </Row>
  );
}
