import { test } from "node:test"
import assert from "node:assert/strict"
import { ICONS, buildScene, checkLayout, normaliseFacts, renderDiagram } from "../src/engine/index.js"

export const transformer = {
  title: "Transformer - Attention Is All You Need",
  subtitle: "encoder-decoder, N = 6",
  groups: [
    { id: "inputs", title: "Inputs" }, { id: "encoder", title: "Encoder (×N)" }, { id: "outputs", title: "Outputs (shifted right)" },
    { id: "decoder", title: "Decoder (×N)" }, { id: "head", title: "Output head" },
  ],
  nodes: [
    { id: "tokens", title: "Input tokens", group: "inputs" },
    { id: "in_embed", title: "Input embedding", detail: "d_model = 512", group: "inputs" },
    { id: "in_pos", title: "Positional encoding", detail: "sin / cos", group: "inputs" },
    { id: "enc_mha", title: "Multi-head attention", detail: "self-attention, 8 heads", group: "encoder" },
    { id: "enc_norm1", title: "Add & norm", group: "encoder" },
    { id: "enc_ffn", title: "Feed forward", detail: "2 linear + ReLU", group: "encoder" },
    { id: "enc_norm2", title: "Add & norm", group: "encoder" },
    { id: "out_tokens", title: "Output tokens", group: "outputs" },
    { id: "out_embed", title: "Output embedding", group: "outputs" },
    { id: "dec_mmha", title: "Masked attention", detail: "causal self-attention", group: "decoder" },
    { id: "dec_norm1", title: "Add & norm", group: "decoder" },
    { id: "dec_xattn", title: "Cross attention", detail: "Q from decoder, K/V from encoder", group: "decoder" },
    { id: "dec_norm2", title: "Add & norm", group: "decoder" },
    { id: "dec_ffn", title: "Feed forward", group: "decoder" },
    { id: "linear", title: "Linear", detail: "to vocabulary size", group: "head" },
    { id: "softmax", title: "Softmax", detail: "next-token probabilities", group: "head" },
  ],
  interfaces: [
    { from: "tokens", to: "in_embed" }, { from: "in_embed", to: "in_pos" }, { from: "in_pos", to: "enc_mha" },
    { from: "enc_mha", to: "enc_norm1" }, { from: "in_pos", to: "enc_norm1", label: "residual" }, { from: "enc_norm1", to: "enc_ffn" },
    { from: "enc_ffn", to: "enc_norm2" }, { from: "enc_norm2", to: "dec_xattn", label: "K, V" },
    { from: "out_tokens", to: "out_embed" }, { from: "out_embed", to: "dec_mmha" }, { from: "dec_mmha", to: "dec_norm1" },
    { from: "dec_norm1", to: "dec_xattn", label: "Q" }, { from: "dec_xattn", to: "dec_norm2" }, { from: "dec_norm2", to: "dec_ffn" },
    { from: "dec_ffn", to: "linear" }, { from: "linear", to: "softmax" },
  ],
}

test("general diagram: a Transformer lays out as columns along the flow, with every connection routed", () => {
  const facts = normaliseFacts(transformer)
  assert.equal(facts.nodes.length, 16)
  assert.ok(facts.nodes.every((n) => n.icon && ICONS[n.icon]), "every node has a real icon")
  assert.equal(facts.nodes.find((n) => n.id === "enc_mha")!.icon, "g_model")
  assert.equal(facts.nodes.find((n) => n.id === "softmax")!.icon, "g_math")
  const scene = buildScene(facts)
  checkLayout(scene)
  assert.equal(scene.frames.length, 0)
  assert.equal(scene.unrouted.length, 0)
  const x = (g: string) => scene.zones.find((z) => z.id === `g_${g}`)!.box[0]
  assert.ok(x("inputs") < x("encoder") && x("encoder") < x("decoder") && x("decoder") < x("head"), "groups follow the flow")
  assert.equal(x("outputs"), x("inputs"), "independent sources share the first column")
  assert.deepEqual(scene.edges.map((e) => e.id).slice(0, 2), ["F-01", "F-02"])
  const { xml } = renderDiagram(transformer)
  assert.match(xml, /&lt;b&gt;Connections&lt;\/b&gt;/)
  assert.match(xml, /value="Encoder \(×N\)"/)
})

test("general diagram: icons may be architecture kinds, unknown groups still render", () => {
  const facts = normaliseFacts({
    title: "Order process", groups: [{ id: "intake", title: "Intake" }],
    nodes: [{ id: "a", title: "Customer", group: "intake" }, { id: "b", title: "Orders DB", icon: "postgres", group: "storage" }],
    interfaces: [{ from: "a", to: "b" }],
  })
  assert.equal(facts.nodes[1].icon, "postgresql")
  const scene = buildScene(facts)
  assert.deepEqual(scene.zones.map((z) => z.title), ["Intake", "storage"])
  assert.equal(scene.unrouted.length, 0)
})
