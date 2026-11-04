import copy
import unittest

from closers.motion_converts import build,resolve,matches,CHECK,CONDITION_WARNING
from closers.motion_extras import references,compile_extras


SOURCE='DUNGEON_MOTION_CONVERT_DATA.NTF'
LINK=dict(source=SOURCE,type='SCT_DUNGEON_MOTION',group=210,state='USN_ASTART1',base_clip='ASTART',character='GUST_INVALID')


def check(group=210,**extra):
    return {1:dict(m_eSkinConvertType='SCT_DUNGEON_MOTION',m_usGroupID=group,**extra)}


class MotionConversionTests(unittest.TestCase):
    def test_inherited_state_and_character_override_are_exact(self):
        layers={'STRIKER':[('base',{'GAME_UNIT_TEMPLET':{'m_mapUnitStateData':{1:dict(m_StateName='USN_ASTART1',m_AnimName='ASTART')}}}),
                           ('own',{'GAME_UNIT_TEMPLET':{'m_mapUnitStateData':{1:dict(m_StateName='USN_ASTART1',m_fAnimSpeed=1)}}})]}
        rows=[[210,'GUST_INVALID','USN_ASTART1','GENERIC'],[210,'GUST_USER_STRIKER','USN_ASTART1','EXACT'],
              [210,'GUST_INVALID','MISSING','GUESS'],[211,'GUST_USER_WITCH','USN_ASTART1','OTHER']]
        result=build({SOURCE:rows},layers)
        self.assertEqual(list(result),[('STRIKER','EXACT')])
        self.assertEqual(result['STRIKER','EXACT'][0]['base_clip'],'ASTART')
        conflict=rows+[[210,'GUST_USER_STRIKER','USN_ASTART1','CONFLICT']]
        self.assertEqual(build({SOURCE:conflict},layers),{})

    def test_group_and_stop_group_checks_are_conservative(self):
        self.assertTrue(matches(check(),LINK))
        self.assertFalse(matches(check(211),LINK))
        self.assertFalse(matches(check(m_setStopGroupID={1:210}),LINK))
        self.assertTrue(matches({1:dict(m_eSkinConvertType=LINK['type'],m_setStopGroupID={1:211})},LINK))
        for value in [check(),{}, {1:dict(m_eSkinConvertType='SCT_SKILL_EFFECT',m_usGroupID=210)},
                      {1:check()[1],2:check()[1]},check(unknown=True),check(-1)]:
            self.assertIsNone(matches(value,None))
        self.assertIsNone(matches(check(unknown=True),LINK))
        self.assertIsNone(matches({1:dict(m_eSkinConvertType='SCT_SKILL_EFFECT',m_usGroupID=210)},LINK))

    def test_false_parent_removes_descendants_and_unknown_parent_stays_conditional(self):
        entries=[dict(key='bad',state=LINK['state'],conditions={CHECK:check(211)}),
                 dict(key='badchild',state=LINK['state'],parent_key='bad'),
                 dict(key='good',state=LINK['state'],status='unavailable',conditions={CHECK:check()},warnings=[CONDITION_WARNING,'missing model']),
                 dict(key='child',state=LINK['state'],parent_key='good'),
                 dict(key='unknown',state=LINK['state'],conditions={'m_ItemID':42}),
                 dict(key='unknownchild',state=LINK['state'],parent_key='unknown'),
                 dict(key='otherstate',state='USN_ASTART2')]
        index={('STRIKER','ASTART'):entries};snapshot=copy.deepcopy(index)
        result=resolve(index,{('STRIKER','VARIANT'):[LINK]},'STRIKER','VARIANT')
        self.assertEqual([e['key'] for e in result],['good','child','unknown','unknownchild'])
        self.assertEqual(result[1]['conditions'],{})
        self.assertEqual(result[0]['warnings'],['missing model'])
        self.assertTrue(result[-1]['conditions']['parent'])
        self.assertEqual(index,snapshot)
        base=resolve(index,{},'STRIKER','ASTART')
        self.assertTrue(next(e for e in base if e['key']=='child')['conditions']['parent'])
        self.assertFalse(resolve(index,{},'STRIKER','CASH_RARE_7_ASTART'))

    def test_direct_entries_take_precedence_and_ambiguous_groups_are_not_guessed(self):
        direct=[dict(key='own',state='OWN')]
        index={('STRIKER','VARIANT'):direct}
        links={('STRIKER','VARIANT'):[LINK,dict(LINK,group=211)]}
        self.assertEqual(resolve(index,links,'STRIKER','VARIANT')[0]['key'],'own')
        self.assertEqual(resolve({},links,'STRIKER','VARIANT'),[])

    def test_shared_clip_keeps_only_identical_events_in_every_group(self):
        links={('STRIKER','SHARED'):[LINK,dict(LINK,group=211)]}
        entries=[dict(key='common',state=LINK['state']),
                 dict(key='only210',state=LINK['state'],conditions={CHECK:check()}),
                 dict(key='child210',state=LINK['state'],parent_key='only210'),
                 dict(key='only211',state=LINK['state'],conditions={CHECK:check(211)}),
                 dict(key='equipment',state=LINK['state'],conditions={'m_ItemID':42}),
                 dict(key='both',state=LINK['state'],conditions={CHECK:{1:dict(m_eSkinConvertType=LINK['type'],m_setStopGroupID={1:212})}})]
        index={('STRIKER','ASTART'):entries};snapshot=copy.deepcopy(index)
        result=resolve(index,links,'STRIKER','SHARED')
        self.assertEqual([e['key'] for e in result],['common','equipment','both'])
        self.assertTrue(all('motion_conversion' not in e for e in result))
        self.assertEqual({c['group'] for c in result[0]['motion_conversion_options']},{210,211})
        self.assertEqual(result[1]['conditions'],{'m_ItemID':42})
        self.assertEqual(index,snapshot)

    def test_shared_clip_does_not_mix_states_scenes_or_partly_resolved_checks(self):
        entries=[dict(key='plain',state=LINK['state']),dict(key='conditional',state=LINK['state'],conditions={CHECK:check()})]
        index={('STRIKER','ASTART'):entries}
        links={('STRIKER','SHARED'):[LINK,dict(LINK,type='SCT_TOWN_MOTION')]}
        self.assertEqual([e['key'] for e in resolve(index,links,'STRIKER','SHARED')],['plain'])
        links['STRIKER','SHARED'][1]=dict(LINK,state='OTHER_STATE',group=211)
        self.assertEqual(resolve(index,links,'STRIKER','SHARED'),[])

    def test_compiler_preserves_source_checks_for_effect_and_equipment(self):
        events=dict(m_StateName=LINK['state'],m_AnimName='ASTART',
            m_EventColor={1:dict(m_mapEventConvertCheckData=check())},
            m_EventEquipHide={1:dict(m_HideEquipPosition='EP_AVATAR_WEAPON',m_mapEventConvertCheckData=check())})
        refs=references({'STRIKER':[('GUST_USER_STRIKER.LUA',{'GAME_UNIT_TEMPLET':{'m_mapUnitStateData':{1:events}}})]})
        result=compile_extras(refs,{},{} )['STRIKER','ASTART']
        self.assertEqual(len(result),2)
        self.assertTrue(all(e['conditions'][CHECK]==check() for e in result))
