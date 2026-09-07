import { useEffect, useState } from "react";
import { Pressable, Text, TextInput, View } from "react-native";
import type { PaymentMethod, PixKeyType } from "@receivy/common";
import type { FinancialClient } from "@/financial/client";

export function FirstSharePix({ client, busy, publish }: { client: Pick<FinancialClient, "paymentMethods" | "savePaymentMethod">; busy: boolean; publish: (id: string) => Promise<void> }) {
  const [items, setItems] = useState<PaymentMethod[]>([]), [selected, setSelected] = useState("");
  const [key, setKey] = useState(""), [type, setType] = useState<PixKeyType>("email"), [error, setError] = useState(""), [saving, setSaving] = useState(false);
  useEffect(() => { void client.paymentMethods().then(page => setItems(page.paymentMethods)).catch(() => setError("Não foi possível carregar as chaves. Reabra a cobrança para tentar novamente.")); }, [client]);
  async function save() { setSaving(true); setError(""); try { const method = await client.savePaymentMethod({ pixKeyType: type, pixKey: key }); setItems(previous => [...previous, method]); setSelected(method.id); setKey(""); } catch (reason) { setError(reason instanceof Error ? reason.message : "Não foi possível salvar a chave."); } finally { setSaving(false); } }
  return <View className="gap-3 rounded-3xl border border-outline bg-surface p-5"><Text className="text-xl font-bold text-primary-strong">Pix antes de compartilhar</Text><Text>Você pode manter este registro sem Pix. Para publicar, escolha a chave que ficará fixa nesta cobrança. O aviso inicial aguardará essa escolha.</Text>
    {items.map(item => <Pressable key={item.id} accessibilityRole="radio" accessibilityState={{ checked: selected === item.id }} onPress={() => setSelected(item.id)} className="min-h-12 justify-center rounded-xl border border-outline p-3"><Text>{selected === item.id ? "✓ " : ""}{item.label || item.pixKeyType} · {item.pixKey}</Text></Pressable>)}
    <Pressable accessibilityRole="button" disabled={busy || saving || !selected} onPress={() => void publish(selected)} className="min-h-12 items-center justify-center rounded-xl bg-primary"><Text className="font-bold text-white">Publicar com este Pix</Text></Pressable>
    <Text className="font-bold">Cadastrar uma chave Pix</Text><View className="flex-row flex-wrap">{(["cpf", "cnpj", "email", "phone", "random"] as PixKeyType[]).map(value => <Pressable key={value} accessibilityRole="radio" accessibilityState={{ checked: type === value }} onPress={() => setType(value)} className="min-h-12 justify-center px-3"><Text>{type === value ? "✓ " : ""}{value.toUpperCase()}</Text></Pressable>)}</View>
    <TextInput accessibilityLabel="Nova chave Pix" value={key} onChangeText={setKey} maxLength={254} autoCapitalize="none" className="min-h-12 rounded-xl border border-outline px-3" /><Pressable accessibilityRole="button" disabled={busy || saving || !key.trim()} onPress={() => void save()} className="min-h-12 justify-center"><Text className="font-bold text-primary">Salvar nova chave</Text></Pressable>{error ? <Text accessibilityRole="alert">{error}</Text> : null}
  </View>;
}
