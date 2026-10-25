import unittest
from closers.motion_sequences import build,resolve


def fixture():
    skills={'SKILL_TEMPLET':{1:{'m_SkillID':'SI_COMMON_EMOTION_TEST','m_UnitStateName':'USN_EMOTION_START',
                             'm_vecUnitStateName_ETC':{1:'USN_EMOTION_END',2:'USN_EMOTION_LOOP'}}}}
    states={1:dict(m_StateName='USN_EMOTION_START',m_AnimName='START',m_PlayType='XAP_ONE_WAIT',m_AnimEndChangeState='USN_EMOTION_LOOP'),
            2:dict(m_StateName='USN_EMOTION_LOOP',m_AnimName='LOOP',m_PlayType='XAP_LOOP',m_CancelState='USN_EMOTION_END',m_fCancelTime=.1),
            3:dict(m_StateName='USN_EMOTION_END',m_AnimName='END',m_PlayType='XAP_ONE_WAIT',m_AnimEndChangeState='USN_ASTAND')}
    rigs={'STRIKER':[('base.LUA',states),('character.LUA',{1:dict(m_StateName='USN_EMOTION_LOOP',m_fAnimSpeed=.5)})]}
    strings={'ST_SI_COMMON_EMOTION_TEST_NAME':('시험 동작','strings.NTF')}
    return skills,rigs,strings


class MotionSequenceTests(unittest.TestCase):
    def test_declared_transitions_override_auxiliary_list_order(self):
        sequence=build(*fixture())['STRIKER'][0]
        self.assertEqual([s['name'] for s in sequence['steps']],['START','LOOP','END'])
        self.assertEqual(sequence['steps'][1]['speed'],.5)
        self.assertEqual(sequence['loop_index'],1);self.assertEqual(sequence['end_index'],2)
        self.assertEqual(sequence['label'],'시험 동작')

    def test_incomplete_cycles_conditional_or_two_loops_are_not_guessed(self):
        for mutate in [lambda states:states[1].pop('m_AnimEndChangeState'),
                       lambda states:states[2].pop('m_CancelState'),
                       lambda states:states[3].update(m_AnimEndChangeState='USN_EMOTION_START'),
                       lambda states:states[3].update(m_PlayType='XAP_LOOP'),
                       lambda states:states[1].update(m_fAnimSpeed=0),
                       lambda states:states[1].update(m_PlayType='CONDITIONAL')]:
            skills,rigs,strings=fixture();mutate(rigs['STRIKER'][0][1])
            self.assertEqual(build(skills,rigs,strings)['STRIKER'],[])
        skills,rigs,strings=fixture()
        rigs['STRIKER'][0][1][4]=dict(m_StateName='USN_EMOTION_START',m_AnimName='OTHER')
        self.assertEqual(build(skills,rigs,strings)['STRIKER'],[])

    def test_pack_sources_and_split_source_ambiguity(self):
        definition=build(*fixture())['STRIKER']
        def file(ident,names,rig=10):return dict(id=ident,skeleton_id=rig,name=f'{ident}.XMD',sha256=str(ident),status='ready',error='',clips=[dict(name=n,index=i,duration=1) for i,n in enumerate(names)])
        result=resolve(definition,[file(1,['START','LOOP','END']),file(2,['START','LOOP','END'])])
        self.assertEqual(len(result),2);self.assertTrue(all(s['status']=='ready' for s in result))
        self.assertNotEqual(result[0]['key'],result[1]['key'])
        result=resolve(definition,[file(1,['START']),file(2,['LOOP']),file(3,['END'])])
        self.assertEqual(result[0]['status'],'ready')
        self.assertEqual([s['animation_id'] for s in result[0]['steps']],[1,2,3])
        for files in [[file(1,['START']),file(2,['LOOP']),file(3,['END'],11)],
                      [file(1,['START']),file(2,['LOOP']),file(3,['LOOP']),file(4,['END'])],
                      [file(1,['START','LOOP'])]]:
            self.assertEqual(resolve(definition,files)[0]['status'],'unavailable')

    def test_bad_lengths_and_failed_bindings_stay_visible(self):
        definition=build(*fixture())['STRIKER']
        definition[0]['steps'][0]['start_time']=.02
        file=dict(id=1,skeleton_id=10,name='all.XMD',sha256='s',status='ready',error='',clips=[dict(name=n,index=i,duration=.01) for i,n in enumerate(['START','LOOP','END'])])
        self.assertEqual(resolve(definition,[file])[0]['status'],'unavailable')
        definition[0]['steps'][0]['start_time']=0
        file['clips'][1]['duration']=1;file.update(status='unavailable',error='뼈 불일치')
        self.assertEqual(resolve(definition,[file])[0]['error'],'뼈 불일치')
