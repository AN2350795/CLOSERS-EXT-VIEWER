export const characters=Object.fromEntries('STRIKER CASTER RANGER FIGHTER LANCER IDOL HUNTER WITCH ROGUE ARMS VALKYRIE VAGABOND LIBRARIAN AEGIS ASTRA MYSTIC BEAST GATEKEEPER NONAME REAPER KNIVES ALTEREGO DEVILISH'.split(' ').map((code,i)=>[code,'이세하 이슬비 서유리 제이 미스틸테인 윤리아 나타 레비아 하피 티나 바이올렛 트리스 볼프강 루나 소마 파이 세트 모아 김철수 미래 은하 루시 애리'.split(' ')[i]]));
export const slots={WEAPON:'무기',HAIR:'헤어',UPBODY:'상의',LOWBODY:'하의',HAND:'장갑',FOOT:'신발',ONE_PIECE:'한 벌'};
export const partLabels={...slots,FACE:'얼굴',EYES:'눈동자',ACC_HEAD_HAIR:'헤어 장식',ACC_HEAD_EAR:'귀 장식',ACC_HEAD_EYE:'눈 장식',ACC_HEAD_MOUTH:'입 장식',ACC_BODY_CHEST:'가슴 장식',ACC_BODY_WING:'등·날개',ACC_BODY_WAIST:'허리 장식',ACC_LEG:'다리 장식',ACC_RING_RIGHT:'오른손 반지',ACC_RING_LEFT:'왼손 반지'};
export function replacePart(sources,item,supplements=[]){
  if(sources.some(s=>s.model_group?.kind!=='avatar'||s.model_group.character&&s.model_group.character!==item.character))throw Error('같은 캐릭터의 아바타에 적용하세요.');
  const parts=new Set([item.part]);
  if(item.part==='ONE_PIECE'){parts.add('UPBODY');parts.add('LOWBODY');}
  if(['UPBODY','LOWBODY'].includes(item.part))parts.add('ONE_PIECE');
  return [...new Set([...sources.filter(s=>!parts.has(s.model_group.part)).map(s=>s.entry_id),item.id,...supplements])];
}
