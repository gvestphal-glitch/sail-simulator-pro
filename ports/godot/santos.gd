extends Node3D

const MODES := Vector4(1.08, 1.57, 3.20, 5.25)
const PHASES := Vector4(0.0, 1.3, 2.1, 4.7)
const SHAPE := Vector4(.06, .07, .09, .07)
const WAVES: Array[Vector4] = [
	Vector4(.39,.921,.119,.22), Vector4(.67,.742,.251,.085),
	Vector4(.91,.414,1.044,.060), Vector4(.98,-.199,2.81,.023)
]
const WIND := Vector2(.7, .714)
const STERN := 2.115

var boat: Node3D
var boom: Node3D
var sailor: Node3D
var rudder: Node3D
var camera: Camera3D
var water: ShaderMaterial
var hud: Label
var wheel: Button
var sheet: VSlider
var hike_button: Button
var pump_button: Button
var time := 0.0
var heading := -.92
var speed := 0.0
var helm := 0.0
var heel := 0.0
var pitch := 0.0
var steering_finger := -2
var steering_origin := 0.0
var trail := PackedVector3Array()
var next_sample := 0.0
var clock := 0.0
var random := RandomNumberGenerator.new()

func material(color: Color, roughness: float, metal := 0.0) -> StandardMaterial3D:
	var mat := StandardMaterial3D.new()
	mat.albedo_color = color
	mat.roughness = roughness
	mat.metallic = metal
	return mat

func object(parent: Node3D, model: Mesh, mat: Material, p: Vector3) -> MeshInstance3D:
	var instance := MeshInstance3D.new()
	instance.mesh = model
	instance.material_override = mat
	instance.position = p
	parent.add_child(instance)
	return instance

func block(parent: Node3D, p: Vector3, size: Vector3, mat: Material) -> void:
	var mesh := BoxMesh.new()
	mesh.size = size
	object(parent, mesh, mat, p)

func tube(parent: Node3D, a: Vector3, b: Vector3, radius: float, mat: Material) -> void:
	var mesh := CylinderMesh.new()
	mesh.top_radius = radius
	mesh.bottom_radius = radius
	mesh.height = a.distance_to(b)
	mesh.radial_segments = 8
	var part := object(parent, mesh, mat, (a+b)*.5)
	var axis := (b-a).normalized()
	var reference := Vector3.RIGHT if absf(axis.x)<.9 else Vector3.FORWARD
	var side := axis.cross(reference).normalized()
	part.basis = Basis(side, axis, side.cross(axis))

func oval(parent: Node3D, p: Vector3, radii: Vector3, mat: Material) -> void:
	var mesh := SphereMesh.new()
	mesh.radial_segments = 18
	mesh.rings = 10
	var part := object(parent, mesh, mat, p)
	part.scale = radii*2

func baked_mesh(tool: SurfaceTool, parent: Node3D, mat: StandardMaterial3D) -> void:
	tool.generate_normals()
	object(parent, tool.commit(), mat, Vector3.ZERO)

func triangle(mesh: SurfaceTool, a: Vector3, b: Vector3, c: Vector3) -> void:
	mesh.add_vertex(a)
	mesh.add_vertex(b)
	mesh.add_vertex(c)

func _ready() -> void:
	random.seed = 1842
	create_environment()
	create_ocean()
	create_shore()
	create_ilca()
	create_hud()
	camera = Camera3D.new()
	camera.fov = 52.0
	camera.far = 9500.0
	add_child(camera)
	camera.current = true
	camera.position = Vector3(5,3,8)
	camera.look_at(Vector3(0,1.6,0))
	trail.resize(24)

func create_environment() -> void:
	var atmosphere := PhysicalSkyMaterial.new()
	atmosphere.turbidity = 2.1
	atmosphere.sun_disk_scale = 1.4
	var sky := Sky.new()
	sky.sky_material = atmosphere
	sky.radiance_size = Sky.RADIANCE_SIZE_128
	var environment := Environment.new()
	environment.background_mode = Environment.BG_SKY
	environment.sky = sky
	environment.ambient_light_source = Environment.AMBIENT_SOURCE_SKY
	environment.ambient_light_energy = .65
	environment.tonemap_mode = Environment.TONE_MAPPER_FILMIC
	environment.fog_enabled = true
	environment.fog_density = .00042
	environment.fog_light_color = Color(.57,.69,.75)
	var world := WorldEnvironment.new()
	world.environment = environment
	add_child(world)
	var sun := DirectionalLight3D.new()
	sun.rotation_degrees = Vector3(-37,-30,0)
	sun.light_color = Color(1,.94,.83)
	sun.light_energy = 1.3
	sun.shadow_enabled = true
	sun.directional_shadow_max_distance = 42
	add_child(sun)

func create_ocean() -> void:
	water = ShaderMaterial.new()
	water.shader = preload("res://water.gdshader")
	water.set_shader_parameter("waves", PackedVector4Array(WAVES))
	water.set_shader_parameter("speeds", MODES)
	water.set_shader_parameter("phases", PHASES)
	water.set_shader_parameter("steepness", SHAPE)
	var inner := PlaneMesh.new()
	inner.size = Vector2(224,224)
	inner.subdivide_width = 223
	inner.subdivide_depth = 223
	var near_water := object(self,inner,water,Vector3.ZERO)
	near_water.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	var far_water := PlaneMesh.new()
	far_water.size = Vector2(12500,12500)
	var distant := object(self,far_water,water,Vector3(0,-.56,0))
	distant.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF

func create_shore() -> void:
	var sand := material(Color(.64,.57,.43),.88)
	var leaves := material(Color(.084,.23,.12),.91)
	var pavement := material(Color(.29,.33,.34),.90)
	var glass := material(Color(.17,.28,.34),.28,.18)
	block(self,Vector3(-270,-2,-780),Vector3(2360,9,260),sand)
	block(self,Vector3(-270,2,-714),Vector3(2360,1,12),pavement)
	for i in range(37):
		var x := -1230.0+i*43.0
		var depth := random.randf_range(-790,-738)
		var h := random.randf_range(26,88)
		var w := random.randf_range(19,36)
		var facade := material(Color.from_hsv(random.randf_range(.06,.15),.14,random.randf_range(.57,.87)),.68)
		block(self,Vector3(x,h*.5,depth),Vector3(w,h,24),facade)
		for y in range(8,int(h)-1,5):
			block(self,Vector3(x,y,depth+12.15),Vector3(w*.82,1.74,.34),glass)
		if i%2==0:
			block(self,Vector3(x,h+2,depth),Vector3(w*.41,4,11),facade)
	for i in range(8):
		oval(self,Vector3(540+i*196,-4,-930-i*39),
			Vector3(218.0,random.randf_range(67,155),210),leaves)
	block(self,Vector3(244,3,-642),Vector3(10,1.4,133),pavement)
	block(self,Vector3(253,3,-574),Vector3(34,1.4,10),pavement)
	for i in range(9):
		for side in [-1,1]:
			block(self,Vector3(244+side*3.8,.5,-704+i*15),Vector3(.7,5,.7),pavement)
	for p in [Vector3(-27,0,-42),Vector3(28,0,-42),Vector3(0,0,-92)]:
		var orange := material(Color(.96,.38,.025),.4)
		tube(self,p-Vector3.UP*.22,p+Vector3.UP*1.2,.31,orange)

func create_ilca() -> void:
	var white := material(Color(.91,.933,.925),.25)
	var carbon := material(Color(.043,.054,.062),.37,.20)
	var alloy := material(Color(.60,.67,.71),.24,.72)
	var dacron := material(Color(.92,.92,.86),.73)
	dacron.cull_mode=BaseMaterial3D.CULL_DISABLED
	var skin := material(Color(.37,.21,.14),.64)
	var vest := material(Color(.67,.11,.03),.55)
	var nonskid := material(Color(.56,.61,.60),.84)
	var shell := SurfaceTool.new()
	shell.begin(Mesh.PRIMITIVE_TRIANGLES)
	var deck := SurfaceTool.new()
	deck.begin(Mesh.PRIMITIVE_TRIANGLES)
	var left_deck := SurfaceTool.new()
	left_deck.begin(Mesh.PRIMITIVE_TRIANGLES)
	boat=Node3D.new()
	add_child(boat)
	# x is the half beam, y the sheer, z the longitudinal bow-to-stern station.
	var stations := [
		Vector3(.43,.28,STERN),Vector3(.57,.29,1.66),Vector3(.66,.33,1.18),
		Vector3(.685,.35,.37),Vector3(.67,.36,-.24),Vector3(.61,.39,-.75),
		Vector3(.45,.42,-1.23),Vector3(.24,.45,-1.76),Vector3(.012,.47,-STERN)
	]
	for i in range(stations.size()-1):
		var a: Vector3=stations[i]
		var b: Vector3=stations[i+1]
		for j in range(12):
			var a0 := PI*j/12.0
			var a1 := PI*(j+1)/12.0
			var p := Vector3(cos(a0)*a.x,a.y-sin(a0)*a.x*.77,a.z)
			var q := Vector3(cos(a1)*a.x,a.y-sin(a1)*a.x*.77,a.z)
			var r := Vector3(cos(a1)*b.x,b.y-sin(a1)*b.x*.77,b.z)
			var s := Vector3(cos(a0)*b.x,b.y-sin(a0)*b.x*.77,b.z)
			triangle(shell,p,q,r)
			triangle(shell,p,r,s)
		var opening_a := .51 if a.z>.05 and a.z<1.75 else 0.0
		var opening_b := .51 if b.z>.05 and b.z<1.75 else 0.0
		for side in [-1.0,1.0]:
			var outer := Vector3(a.x*side,a.y,a.z)
			var next := Vector3(b.x*side,b.y,b.z)
			var inside_a := Vector3(a.x*opening_a*side,a.y+.025,a.z)
			var inside_b := Vector3(b.x*opening_b*side,b.y+.025,b.z)
			var target := deck if side>0 else left_deck
			triangle(target,outer,next,inside_b)
			triangle(target,outer,inside_b,inside_a)
	white.cull_mode=BaseMaterial3D.CULL_DISABLED
	baked_mesh(shell,boat,white)
	baked_mesh(deck,boat,white)
	baked_mesh(left_deck,boat,white)
	block(boat,Vector3(0,.19,.86),Vector3(.68,.055,1.64),nonskid)
	block(boat,Vector3(0,.17,-.06),Vector3(.039,1.21,.34),white)
	rudder=Node3D.new()
	rudder.position=Vector3(0,.27,STERN)
	boat.add_child(rudder)
	block(rudder,Vector3(0,-.33,.075),Vector3(.044,.89,.27),white)
	tube(rudder,Vector3(0,.06,.10),Vector3(0,.11,-.83),.023,carbon)
	tube(boat,Vector3(0,.35,-.92),Vector3(0,3.26,-.91),.032,alloy)
	tube(boat,Vector3(0,3.26,-.91),Vector3(0,6.12,-.86),.024,carbon)
	boom=Node3D.new()
	boom.position=Vector3(0,1.02,-.92)
	boat.add_child(boom)
	tube(boom,Vector3.ZERO,Vector3(0,0,2.62),.027,alloy)
	var sail := SurfaceTool.new()
	sail.begin(Mesh.PRIMITIVE_TRIANGLES)
	for row in range(22):
		for col in range(10):
			var p := sail_point(row/22.0,col/10.0)
			var q := sail_point(row/22.0,(col+1)/10.0)
			var r := sail_point((row+1)/22.0,(col+1)/10.0)
			var s := sail_point((row+1)/22.0,col/10.0)
			triangle(sail,p,q,r)
			triangle(sail,p,r,s)
	baked_mesh(sail,boom,dacron)
	for y in [.29,.56,.77]:
		for column in range(8):
			tube(boom,sail_point(y,column/8.0),sail_point(y,(column+1)/8.0),.003,white)
	sailor=Node3D.new()
	sailor.position=Vector3(.27,.48,.88)
	boat.add_child(sailor)
	oval(sailor,Vector3(0,.30,0),Vector3(.19,.29,.145),vest)
	oval(sailor,Vector3(.015,.64,-.015),Vector3(.10,.127,.093),skin)
	oval(sailor,Vector3(.015,.725,-.015),Vector3(.102,.055,.10),carbon)
	oval(sailor,Vector3(.015,.70,-.107),Vector3(.084,.014,.105),carbon)
	for side in [-1.0,1.0]:
		tube(sailor,Vector3(.10*side,.45,0),Vector3(.19*side,.28,-.16),.047,carbon)
		tube(sailor,Vector3(.19*side,.28,-.16),Vector3(.19*side,.24,-.33),.037,skin)
		tube(sailor,Vector3(.06*side,.04,.02),Vector3(.21*side,-.15,-.23),.069,carbon)
		tube(sailor,Vector3(.21*side,-.15,-.23),Vector3(.03*side,-.24,-.37),.055,carbon)

func sail_point(row: float, col: float) -> Vector3:
	var width := 2.62*pow(1.0-row,1.2)+.04*row
	return Vector3(sin(col*PI)*sin(row*PI)*width*.17,5.03*row+.10*col*sin(row*PI),width*col)

func control_button(panel: Control, caption: String, left: float, top: float, w: float, h: float) -> Button:
	var button := Button.new()
	button.text = caption
	button.position = Vector2(left,top)
	button.size = Vector2(w,h)
	button.focus_mode = Control.FOCUS_NONE
	panel.add_child(button)
	return button

func create_hud() -> void:
	var layer := CanvasLayer.new()
	add_child(layer)
	var panel := ColorRect.new()
	panel.color = Color(.037,.087,.099,.88)
	layer.add_child(panel)
	panel.set_anchors_and_offsets_preset(Control.PRESET_BOTTOM_WIDE)
	panel.offset_top=-132
	var left := Control.new()
	panel.add_child(left)
	left.position=Vector2(33,15)
	hike_button=control_button(left,"Escora",0,0,107,46)
	pump_button=control_button(left,"Bombar",0,55,107,46)
	sheet=VSlider.new()
	sheet.min_value=0
	sheet.max_value=1
	sheet.step=.01
	sheet.value=.34
	sheet.position=Vector2(131,0)
	sheet.size=Vector2(45,101)
	sheet.focus_mode=Control.FOCUS_NONE
	left.add_child(sheet)
	var sheet_label := Label.new()
	sheet_label.text="Grande"
	sheet_label.position=Vector2(179,1)
	left.add_child(sheet_label)
	var right := Control.new()
	panel.add_child(right)
	right.set_anchors_and_offsets_preset(Control.PRESET_TOP_RIGHT)
	right.position-=Vector2(161,-15)
	wheel=control_button(right,"←   Leme   →",0,0,128,96)
	hud=Label.new()
	hud.horizontal_alignment=HORIZONTAL_ALIGNMENT_CENTER
	hud.vertical_alignment=VERTICAL_ALIGNMENT_CENTER
	hud.mouse_filter=Control.MOUSE_FILTER_IGNORE
	panel.add_child(hud)
	hud.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	hud.add_theme_font_size_override("font_size",24)
	hud.modulate=Color(.83,.93,.65)

var action_fingers := {}
var sheet_finger := -2

func set_sheet(y: float) -> void:
	var bounds := sheet.get_global_rect()
	sheet.value=clampf((y-bounds.position.y)/bounds.size.y,0.0,1.0)

func pointer_start(id: int, p: Vector2) -> void:
	if wheel.get_global_rect().has_point(p) and steering_finger==-2:
		steering_finger=id
		steering_origin=p.x
	elif sheet.get_global_rect().has_point(p) and sheet_finger==-2:
		sheet_finger=id
		set_sheet(p.y)
	elif hike_button.get_global_rect().has_point(p):
		action_fingers[id]=hike_button
		hike_button.set_pressed_no_signal(true)
	elif pump_button.get_global_rect().has_point(p):
		action_fingers[id]=pump_button
		pump_button.set_pressed_no_signal(true)

func pointer_move(id: int, p: Vector2) -> void:
	if steering_finger==id:
		helm=clampf((p.x-steering_origin)/49.0,-1.0,1.0)
		wheel.text="←  Leme" if helm<-.1 else "Leme  →" if helm>.1 else "←   Leme   →"
	elif sheet_finger==id:
		set_sheet(p.y)

func pointer_end(id: int) -> void:
	if steering_finger==id:
		steering_finger=-2
		helm=0
		wheel.text="←   Leme   →"
	if sheet_finger==id:
		sheet_finger=-2
	var button: Button=action_fingers.get(id)
	action_fingers.erase(id)
	if button!=null:
		button.set_pressed_no_signal(action_fingers.values().has(button))

func _notification(what: int) -> void:
	if what==NOTIFICATION_APPLICATION_FOCUS_OUT and wheel!=null:
		pointer_end(steering_finger)
		pointer_end(sheet_finger)
		for id in action_fingers.keys():
			pointer_end(id)

func _input(event: InputEvent) -> void:
	if event is InputEventScreenTouch:
		if event.pressed and not event.canceled:
			pointer_start(event.index,event.position)
		else:
			pointer_end(event.index)
	elif event is InputEventScreenDrag:
		pointer_move(event.index,event.position)
	elif event is InputEventMouseButton and event.button_index==MOUSE_BUTTON_LEFT:
		if event.pressed:
			pointer_start(-1,event.position)
		else:
			pointer_end(-1)
	elif event is InputEventMouseMotion and event.button_mask&MOUSE_BUTTON_MASK_LEFT:
		pointer_move(-1,event.position)

func wave_height(x: float, z: float) -> float:
	var level := 0.0
	for i in range(WAVES.size()):
		var wave: Vector4=WAVES[i]
		var c := cos((x*wave.x+z*wave.y)*wave.z+time*MODES[i]+PHASES[i])
		level+=wave.w*(c+SHAPE[i]*(2*c*c-1))
	return level

func _physics_process(dt: float) -> void:
	time+=dt
	var steer := clampf(helm+Input.get_axis("ui_left","ui_right"),-1,1)
	heading-=steer*minf(speed/1.65,1.0)*.78*dt
	var bow := Vector2(-sin(heading),-cos(heading))
	var twa := bow.angle_to(WIND)
	var awa := bow.angle_to(WIND*5.9+bow*speed)
	var trim_value := float(sheet.value)
	if Input.is_action_pressed("ui_up"):
		sheet.value-=dt*.44
	if Input.is_action_pressed("ui_down"):
		sheet.value+=dt*.44
	var pumping := action_fingers.values().has(pump_button) or Input.is_physical_key_pressed(KEY_B)
	if pumping:
		trim_value=maxf(0,trim_value-.30)
	var desired_trim := clampf((absf(awa)-.47)/1.30,0,1)
	var efficiency := exp(-3.3*pow(trim_value-desired_trim,2))
	var drive := smoothstep(.51,.86,absf(twa))*(2.23+.55*sin(absf(twa)))
	speed=move_toward(speed,drive*efficiency*(1-.20*absf(steer)),dt*.65)
	var p := boat.position
	var motion:=bow*speed*dt
	p.x=clampf(p.x+motion.x,-96,96)
	p.z=clampf(p.z+motion.y,-96,96)
	var hiking := action_fingers.values().has(hike_button) or Input.is_physical_key_pressed(KEY_SPACE)
	var left:=bow.rotated(-PI*.5)
	var bow_level:=wave_height(p.x+bow.x*1.65,p.z+bow.y*1.65)
	var stern_level:=wave_height(p.x-bow.x*1.65,p.z-bow.y*1.65)
	var roll_wave:=wave_height(p.x+left.x*.6,p.z+left.y*.6)-wave_height(p.x-left.x*.6,p.z-left.y*.6)
	p.y=lerpf(p.y,(bow_level+stern_level+2*wave_height(p.x,p.z))*.25,1-exp(-8*dt))
	pitch=lerpf(pitch,(bow_level-stern_level)/3.3,1-exp(-5*dt))
	heel=lerpf(heel,signf(awa)*(1-float(hiking)*.62)*.32*sin(absf(awa))+roll_wave*.36,1-exp(-4*dt))
	boat.position=p
	boat.rotation=Vector3(pitch,heading,heel)
	rudder.rotation.y=steer*.49
	boom.rotation.y=signf(awa)*(.12+trim_value*1.28)
	sailor.position.x=lerpf(sailor.position.x,signf(awa)*(.24+float(hiking)*.24),1-exp(-5*dt))
	sailor.rotation.z=lerpf(sailor.rotation.z,-signf(awa)*float(hiking)*.49,1-exp(-6*dt))
	var chase:=p+Vector3(-bow.x*8,2.9,-bow.y*8)+Vector3(left.x*2.15,0,left.y*2.15)
	camera.position=camera.position.lerp(chase,1-exp(-3.2*dt))
	camera.look_at(p+Vector3(bow.x*1.75,1.69,bow.y*1.75))
	update_wake(p,bow)
	clock+=dt
	if clock>.10:
		clock=0
		var course:=posmod(roundi(rad_to_deg(-heading)),360)
		hud.text="%.1f nós   |   %03d°\nGrande  %d%%" % [speed/0.514444,course,roundi((1-trim_value)*100)]

func update_wake(p: Vector3, bow: Vector2) -> void:
	if time>=next_sample:
		next_sample=time+.15
		if speed>.22:
			trail.insert(0,Vector3(p.x-bow.x*STERN,p.z-bow.y*STERN,time))
			trail.resize(24)
	var count:=0
	var samples:=PackedVector3Array()
	samples.resize(24)
	for i in range(trail.size()):
		var point:=trail[i]
		if point.z<=0 or time-point.z>4.2:
			break
		samples[i]=Vector3(point.x,point.y,time-point.z)
		count+=1
	water.set_shader_parameter("clock",time)
	water.set_shader_parameter("wake_count",count)
	water.set_shader_parameter("wake_points",samples)
