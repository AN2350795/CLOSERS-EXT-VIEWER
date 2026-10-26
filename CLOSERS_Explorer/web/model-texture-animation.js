// A shared first image can have skill, emotion and victory variants. Select
// only a unique exact character/activity name match; keep ambiguity visible.
export function chooseTextureSequence(input,packet){
  if(input.texture_animation)return input.texture_animation;
  const choices=input.texture_animation_choices||[],clip=(packet.clip?.name||'').toUpperCase();
  if(!choices.length)return null;
  const activity=clip.includes('EMOTION')?'EMOTION':clip.includes('WIN')?'WIN':clip.includes('PSYCHIC_MOVE')?'PSYCHIC':clip.includes('ASTART')?'ASTART':null;
  if(!activity)return null;
  const character=packet.skeleton_source?.name.toUpperCase().match(/^MOTION_([A-Z]+)(?:_|\.)/)?.[1];
  const allowed=choices.filter(s=>!s.characters?.length||s.characters.includes(character));
  let candidates=allowed.filter(s=>s.name.toUpperCase().split('_').includes(activity));
  const specific=candidates.filter(s=>s.characters?.includes(character));
  if(specific.length)candidates=specific;
  if(!candidates.length)candidates=allowed.filter(s=>!s.characters?.length&&!s.name.toUpperCase().split('_').some(t=>['EMOTION','WIN','PSYCHIC','ASTART'].includes(t)));
  return candidates.length===1?candidates[0]:null;
}
