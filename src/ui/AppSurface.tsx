import { ActivityIndicator, AppState as RNAppState, Pressable, StyleSheet, View, type StyleProp, type TextStyle, type ViewStyle } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { AppText as Text } from './AppText';
import { useEffect } from 'react';
import type { ComponentProps, ReactNode } from 'react';
import Animated, { cancelAnimation, useAnimatedStyle, useSharedValue, withRepeat, withTiming } from 'react-native-reanimated';
import { AppIcon } from './AppIcon';
import { control, elevation, layout, radius, spacing, typography } from '../theme';
import { useAppPreferences } from '../app/AppPreferences';

type AppCardProps={children:ReactNode;style?:StyleProp<ViewStyle>;elevated?:boolean};
export function AppCard({children,style,elevated=false}:AppCardProps){const{design}=useAppPreferences();return <View style={[styles.card,{backgroundColor:design.cardFill,borderColor:design.cardBorder,borderRadius:design.radiusCard},design.shadow??undefined,elevated&&elevation.soft,style]}>{children}</View>}

type AppButtonProps={label:string;icon?:ComponentProps<typeof AppIcon>['name'];onPress:()=>void;variant?:'primary'|'secondary'|'danger'|'ghost';loading?:boolean;disabled?:boolean;accessibilityLabel?:string;style?:StyleProp<ViewStyle>};
export function AppButton({label,icon,onPress,variant='primary',loading=false,disabled=false,accessibilityLabel,style}:AppButtonProps){const{colors,design,themeMode}=useAppPreferences();const disabledState=disabled||loading;const background=variant==='primary'?colors.primary:variant==='danger'?colors.danger:variant==='secondary'?colors.surfaceMuted:'transparent';const off=disabled&&!loading;const foreground=off?colors.textSecondary:variant==='primary'?(themeMode==='dim'?colors.onPrimary:'#FFFFFF'):variant==='danger'?colors.onPrimary:colors.primary;return <Pressable accessibilityRole="button" accessibilityLabel={accessibilityLabel??label} accessibilityState={{disabled:disabledState,busy:loading}} disabled={disabledState} onPress={onPress} style={({pressed})=>StyleSheet.flatten([styles.button,{backgroundColor:off?colors.surfaceSunken:background,borderColor:variant==='ghost'&&!off?'transparent':colors.border,opacity:off?1:disabledState?.7:pressed?.82:1,borderRadius:design.radiusButton,overflow:'hidden'},variant==='primary'&&!disabledState?(design.shadow??undefined):undefined,style])}>{variant==='primary'&&!off?<LinearGradient pointerEvents="none" colors={design.ctaGrad} start={{x:0,y:0}} end={{x:1,y:1}} style={StyleSheet.absoluteFill}/>:null}{loading?<ActivityIndicator color={foreground}/>:icon?<AppIcon name={icon} size={control.iconSize-3} color={foreground}/>:null}{!loading?<Text numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.82} maxFontSizeMultiplier={1.5} style={[styles.buttonText,{color:foreground}]}>{label}</Text>:null}</Pressable>}

type AppIconButtonProps={icon:ComponentProps<typeof AppIcon>['name'];onPress:()=>void;label:string;variant?:'neutral'|'primary'|'danger';disabled?:boolean;loading?:boolean;style?:StyleProp<ViewStyle>};
export function AppIconButton({icon,onPress,label,variant='neutral',disabled=false,loading=false,style}:AppIconButtonProps){const{colors}=useAppPreferences();const color=variant==='danger'?colors.danger:variant==='primary'?colors.primary:colors.textSecondary;const background=variant==='primary'?colors.surfaceMuted:colors.surface;return <Pressable accessibilityRole="button" accessibilityLabel={label} accessibilityState={{disabled:disabled||loading,busy:loading}} disabled={disabled||loading} onPress={onPress} style={({pressed})=>[styles.iconButton,{backgroundColor:background,borderColor:colors.border,opacity:disabled||loading?.5:pressed?.78:1},style]}>{loading?<ActivityIndicator size="small" color={color}/>:<AppIcon name={icon} size={control.iconSize-1} color={color}/>}</Pressable>}

type AppBadgeProps={label:string;tone?:'primary'|'success'|'warning'|'danger'|'neutral';style?:StyleProp<TextStyle>};
export function AppBadge({label,tone='neutral',style}:AppBadgeProps){const{colors}=useAppPreferences();const palette=tone==='primary'?{bg:colors.primaryTint,fg:colors.primary}:tone==='success'?{bg:colors.success+'26',fg:colors.success}:tone==='warning'?{bg:colors.warning+'26',fg:colors.warning}:tone==='danger'?{bg:colors.danger+'26',fg:colors.danger}:{bg:colors.surfaceMuted,fg:colors.textSecondary};return <View style={[styles.badge,{backgroundColor:palette.bg}]}><Text numberOfLines={1} maxFontSizeMultiplier={1.4} style={[styles.badgeText,{color:palette.fg},style]}>{label}</Text></View>}

type AppSectionHeaderProps={title:string;description?:string;actionLabel?:string;onAction?:()=>void};
export function AppSectionHeader({title,description,actionLabel,onAction}:AppSectionHeaderProps){const{colors}=useAppPreferences();return <View style={styles.sectionHeader}><View style={styles.sectionCopy}><Text maxFontSizeMultiplier={1.5} style={[styles.sectionTitle,{color:colors.textPrimary}]}>{title}</Text>{description?<Text style={[styles.sectionDescription,{color:colors.textSecondary}]}>{description}</Text>:null}</View>{actionLabel&&onAction?<Pressable accessibilityRole="button" accessibilityLabel={actionLabel} onPress={onAction} style={({pressed})=>[styles.sectionAction,pressed&&styles.pressed]}><Text maxFontSizeMultiplier={1.4} style={[styles.sectionActionText,{color:colors.primary}]}>{actionLabel}</Text><AppIcon name="chevron-right" size={17} color={colors.primary}/></Pressable>:null}</View>}

type AppStateProps={title:string;description?:string;icon?:ComponentProps<typeof AppIcon>['name'];loading?:boolean;actionLabel?:string;onAction?:()=>void};
export function AppState({title,description,icon='information-outline',loading=false,actionLabel,onAction}:AppStateProps){const{colors}=useAppPreferences();return <View style={styles.state} accessibilityRole={loading?'progressbar':undefined}>{loading?<ActivityIndicator size="large" color={colors.primary}/>:<View style={[styles.stateIcon,{backgroundColor:colors.surfaceMuted}]}><AppIcon name={icon} size={28} color={colors.primary}/></View>}<Text maxFontSizeMultiplier={1.6} style={[styles.stateTitle,{color:colors.textPrimary}]}>{title}</Text>{description?<Text style={[styles.stateDescription,{color:colors.textSecondary}]}>{description}</Text>:null}{actionLabel&&onAction?<AppButton label={actionLabel} onPress={onAction} variant="secondary"/>:null}</View>}

// A calm placeholder for lists that are still loading — a few pulsing card-shaped bars.
// Reads as "content is coming" far better than a lone centre spinner. Honours reduce-motion
// (then the bars just sit still at a low opacity).
export function AppSkeletonList({rows=4}:{rows?:number}){
  const{colors,reduceMotion,language}=useAppPreferences();
  const pulse=useSharedValue(0.5);
  useEffect(()=>{
    if(reduceMotion){pulse.value=0.45;return;}
    const start=()=>{pulse.value=withRepeat(withTiming(0.85,{duration:820}),-1,true);};
    if(RNAppState.currentState==='active')start();
    const sub=RNAppState.addEventListener('change',(st)=>{if(st==='active')start();else{cancelAnimation(pulse);pulse.value=0.5;}});
    return()=>{sub.remove();cancelAnimation(pulse);};
  },[reduceMotion,pulse]);
  const shimmer=useAnimatedStyle(()=>({opacity:pulse.value}));
  return <View style={styles.skeletonWrap} accessibilityRole="progressbar" accessibilityLabel={language==='bn'?'লোড হচ্ছে':'Loading'}>
    {Array.from({length:rows}).map((_,i)=>(
      <Animated.View key={i} style={[styles.skeletonRow,{backgroundColor:colors.surfaceMuted,borderColor:colors.border},shimmer]}>
        <View style={[styles.skeletonDot,{backgroundColor:colors.border}]}/>
        <View style={styles.skeletonLines}>
          <View style={[styles.skeletonLine,{backgroundColor:colors.border,width:'70%'}]}/>
          <View style={[styles.skeletonLine,{backgroundColor:colors.border,width:'40%'}]}/>
        </View>
      </Animated.View>
    ))}
  </View>;
}

const styles=StyleSheet.create({card:{borderWidth:1,borderRadius:radius.card,padding:spacing.md},
  skeletonWrap:{paddingHorizontal:spacing.lg,paddingTop:spacing.sm,gap:spacing.sm},
  skeletonRow:{minHeight:control.rowMinHeight,borderWidth:1,borderRadius:radius.card,padding:spacing.sm,flexDirection:'row',alignItems:'center',gap:spacing.sm},
  skeletonDot:{width:control.smallIconContainer,height:control.smallIconContainer,borderRadius:radius.md},
  skeletonLines:{flex:1,gap:spacing.sm},
  skeletonLine:{height:10,borderRadius:radius.pill},button:{minHeight:control.buttonHeight,minWidth:layout.minTouchTarget,maxWidth:'100%',borderWidth:1,borderRadius:radius.button,paddingHorizontal:spacing.md,alignItems:'center',justifyContent:'center',flexDirection:'row',gap:spacing.sm},buttonText:{...typography.bodySmall,fontWeight:'800',flexShrink:1,textAlign:'center'},iconButton:{width:layout.iconButtonSize,height:layout.iconButtonSize,borderWidth:1,borderRadius:radius.button,alignItems:'center',justifyContent:'center'},badge:{alignSelf:'flex-start',minHeight:28,paddingHorizontal:spacing.sm,borderRadius:radius.chip,alignItems:'center',justifyContent:'center'},badgeText:{fontSize:11,lineHeight:15,fontWeight: '700'},sectionHeader:{minHeight:layout.minTouchTarget,flexDirection:'row',alignItems:'center',gap:spacing.sm},sectionCopy:{flex:1,minWidth:0},sectionTitle:{fontSize:17,lineHeight:23,fontWeight: '700'},sectionDescription:{fontSize:12,lineHeight:18,marginTop:2},sectionAction:{minHeight:layout.minTouchTarget,paddingHorizontal:spacing.xs,flexDirection:'row',alignItems:'center',gap:2},sectionActionText:{fontSize:12,fontWeight: '700'},state:{alignItems:'center',justifyContent:'center',paddingHorizontal:spacing.lg,paddingVertical:spacing.xl,gap:spacing.sm},stateIcon:{width:spacing.lgPlus+spacing.smd,height:spacing.lgPlus+spacing.smd,borderRadius:radius.lg,alignItems:'center',justifyContent:'center'},stateTitle:{fontSize:18,lineHeight:24,fontWeight: '700',textAlign:'center'},stateDescription:{...typography.bodySmall,maxWidth:420,textAlign:'center'},pressed:{opacity:.78}});
