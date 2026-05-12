'use strict';
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY,
  { auth: { persistSession: false } }
);

async function initDB() {
  const { error } = await supabase.from('products').select('id').limit(1);
  if (error) throw new Error(`Supabase 연결 오류: ${error.message}`);
  console.log('[db] Supabase 연결 성공');
}

async function getOrCreatePart(partNumber, partName, spec = '', unit = 'EA') {
  const { data, error } = await supabase
    .from('parts')
    .upsert({ part_number: partNumber, part_name: partName, spec, unit },
             { onConflict: 'part_number' })
    .select()
    .single();
  if (error) throw error;
  return data;
}

async function getBOMItems(productId) {
  const { data, error } = await supabase
    .from('bom_items')
    .select('*, parts(*)')
    .eq('product_id', productId)
    .order('row_order');
  if (error) throw error;
  return (data || []).map(row => ({
    id: row.id,
    product_id: row.product_id,
    part_id: row.part_id,
    quantity: parseFloat(row.quantity),
    row_order: row.row_order,
    position: row.position,
    notes: row.notes,
    part: {
      id: row.parts.id,
      part_number: row.parts.part_number,
      part_name: row.parts.part_name,
      spec: row.parts.spec,
      unit: row.parts.unit,
    },
  }));
}

module.exports = { supabase, initDB, getOrCreatePart, getBOMItems };
