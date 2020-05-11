// Program: tfprof
// Author: twhuang
//

'use strict';

var state = {
  
  // DOMAIN (data) -> RANGE (graph)

  // main timeline svg
  dom : null,
  svg : null,                     // svg block
  graph: null,                    // graph block
  graphW: 0,
  graphH: 0,
  zoomX: [null, null],            // scoped time data
  zoomY: [null, null],            // scoped line data
 
  // main graph
  width: window.innerWidth,
  height: 650,
  maxHeight: Infinity,
  maxLineHeight: 20,
  leftMargin: 100,
  rightMargin: 100,
  topMargin: 26,
  bottomMargin: 30,
  
  // overview element
  overviewAreaSvg: null,
  overviewAreaScale: d3.scaleLinear(),
  overviewAreaSelection: [null, null],
  overviewAreaDomain: [null, null],
  overviewAreaBrush: null,
  overviewAreaTopMargin: 1,
  overviewAreaBottomMargin: 30,
  overviewAreaXGrid: d3.axisBottom().tickFormat(''),
  overviewAreaXAxis: d3.axisBottom().tickPadding(0),
  overviewAreaBrush: d3.brushX(),

  // bar chart
  barSvg : null,
  barXScale: d3.scaleBand(),
  barYScale: d3.scaleLinear(),
  barXAxis: d3.axisBottom(),
  barYAxis: d3.axisLeft(),
  barHeight: 350,
  barWidth: window.innerWidth,
  barLeftMargin: 100,
  barRightMargin: 100,
  barTopMargin: 20,
  barBottomMargin: 100,

  // axes attributes
  xScale: d3.scaleLinear(),
  yScale: d3.scalePoint(),  
  grpScale: d3.scaleOrdinal(),
  xAxis: d3.axisBottom(),
  xGrid: d3.axisTop(),
  yAxis: d3.axisRight(),
  grpAxis: d3.axisLeft(),
  minLabelFont: 2,

  // legend
  zColorMap: new Map([
    ['static', '#4682b4'],
    ['subflow', '#ff7f0e'],
    ['cudaflow', '#6A0DAD'],
    ['condition', '#41A317'],
    ['module', '#0000FF']
  ]),
  zScale: null,
  zGroup: null,
  zWidth: null,
  zHeight: null,

  // date marker line
  dateMarker: null,
  dateMarkerLine: null,
  
  // segmenet  
  minSegmentDuration: 0, // ms
  disableHover: false,
  minX: null,
  maxY: null,
  
  // transition
  transDuration: 700,

  // data field
  completeStructData: [],       // executors and lines
  completeFlatData: [],         // flat segments with gropu and line
  completeBarData: [],        // bar char data
  structData: null,
  flatData: null,
  totalNLines: 0,
  nLines: 0
};

// Procedure: make_tfp_structure
function make_tfp_structure(dom_element) {
  
  //console.log("timeline chart created at", dom_element);
  
  state.dom = d3.select('#tfp').attr('class', 'tfp');

  // main svg
  state.svg = state.dom.append('svg');

  //console.log("_make_tfp_structure");
    
  state.yScale.invert = _invertOrdinal;
  state.grpScale.invert = _invertOrdinal;
  
  _make_tfp_gradient_field();
  _make_tfp_axes();
  _make_tfp_legend();
  _make_tfp_graph();
  _make_tfp_date_marker_line();
  _make_tfp_overview();
  _make_tfp_bar();
  _make_tfp_tooltips();
  _make_tfp_events();
}

// Procedure: feed()
function feed(rawData) {

  // clear the previous state
  state.zoomX = [null, null];
  state.zoomY = [null, null];
  state.minX  = null;
  state.maxX  = null;
  state.completeStructData = [];
  state.completeFlatData = [];
  state.completeBarData = [];
  state.totalNLines = 0;

  // iterate executor
  for (let i=0, ilen=rawData.length; i<ilen; i++) {
    const executor = rawData[i].executor;

    state.completeStructData.push({
      executor: executor,
      lines: rawData[i].data.map(d => d.worker)
    });
    
    // iterate worker
    for (let j= 0, jlen=rawData[i].data.length; j<jlen; j++) {
      var total_time=0, stime=0, dtime=0, gtime=0, ctime=0, mtime=0;
      // iterate segment
      for (let k= 0, klen=rawData[i].data[j].data.length; k<klen; k++) {
        const { span, type, name } = rawData[i].data[j].data[k];

        state.completeFlatData.push({
          executor: executor,
          worker: rawData[i].data[j].worker,
          span: span,
          type: type,                             // legend value
          name: name
        });

        if(state.minX == null || span[0] < state.minX) {
          state.minX = span[0];
        }

        if(state.maxX == null || span[1] > state.maxX) {
          state.maxX = span[1];
        }
        
        const elapsed = span[1] - span[0];
        total_time += elapsed;

        switch(type) {
          case "static":
            stime += elapsed;
          break;

          case "subflow":
            dtime += elapsed;
          break;

          case "cudaflow":
            gtime += elapsed;
          break;

          case "condition":
            ctime += elapsed;
          break;

          case "module":
            mtime += elapsed;
          break;

          default:
            console.assert(false);
          break;
        }
      }

      state.completeBarData.push({
        "executor": executor,
        "worker": rawData[i].data[j].worker,
        "tasks": rawData[i].data[j].data.length,
        "static": stime,
        "subflow": dtime,
        "cudaflow": gtime,
        "condition": ctime,
        "module": mtime,
        "busy": total_time
      });

      state.totalNLines++;
    }
  }

  //state.completeBarData.sort((a, b) => {
  //  return b.busy - a.busy;
  //});

  // static data fields
  state.overviewAreaDomain = [state.minX, state.maxX];

  // update all dynamic fields
  update([state.minX, state.maxX], [null, null]);
  
  // update the bar chart fields
  update_bar(null, null);
}

// Procedure: update
function update(zoomX, zoomY) {
  
  // if the successive change is small, we don't update;
  // this also avoids potential infinite loops caused by cyclic event updates
  if((state.zoomX[0] == zoomX[0] && state.zoomX[1] == zoomX[1] &&
      state.zoomY[0] == zoomY[0] && state.zoomY[1] == zoomY[1]) ||
    (Math.abs(state.zoomX[0] - zoomX[0]) < Number.EPSILON && 
     Math.abs(state.zoomX[1] - zoomX[1]) < Number.EPSILON &&
     Math.abs(state.zoomY[0] - zoomY[0]) < Number.EPSILON && 
     Math.abs(state.zoomY[1] - zoomY[1]) < Number.EPSILON)) {
    //console.log("skip update", state.zoomX, state.zoomY, zoomX, zoomY);
    return;
  }
  
  // we use zoomX and zoomY to control the update
  state.zoomX = zoomX;
  state.zoomY = zoomY;
  state.overviewAreaSelection = state.zoomX;

  //console.log("update");

  _apply_filters();
  _adjust_dimensions();
  _adjust_xscale();
  _adjust_yscale();
  _adjust_grpscale();
  _adjust_legend();
    
  _render_axes()
  _render_executors();
  _render_timelines();
  _render_overview_area();
}

function update_bar(selexe, seltask) {

  var exeopt = d3.select("#tfp-bar-sel-executor").selectAll("option")
		.data(['executor (all)', ...state.completeStructData.map(d=>d.executor)])

  exeopt.exit().remove();
  exeopt = exeopt.merge(exeopt.enter().append('option')).text(d=>d);

  if(selexe == null) {
    d3.select('#tfp-bar-sel-executor').node().options[0].selected = true; 
  }
  if(seltask == null) {
    d3.select('#tfp-bar-sel-task-type').node().options[0].selected = true;
  }

  var data;
  
  //console.log("complete data", state.completeBarData, selexe, seltask);

  // filter executor
  data = state.completeBarData.filter( d => {
    return (selexe == null  || d.executor == selexe);
  });
  
  // filter task type
  const keys = (seltask == null) ? Array.from(state.zColorMap.keys()) : [seltask];

  //console.log("keys", keys)

  var stacked_data = d3.stack().keys(keys)(data);

  const ymax = (seltask != null) ?  
    d3.max(stacked_data[0], d=>d[1]) : d3.max(data, d=>d.busy)

  //console.log(stacked_data)
  //console.log("filtered data", data);

  state.barXScale.padding(0.5)
    .domain(data.map(d=>`${d.executor}+&+${d.worker}`))
    .range([state.barLeftMargin, state.barWidth-state.barRightMargin]);
  
  state.barYScale
    .domain([0, ymax])
    .range([state.barHeight - state.barBottomMargin, state.barTopMargin]);
  
  //let maxChars = Math.ceil(state.rightMargin/(14/Math.SQRT2));

  state.barXAxis.scale(state.barXScale)
    .tickSizeOuter(0)
    .tickFormat(d => d.split('+&+')[1]);
  
  state.barYAxis.scale(state.barYScale)
    .tickSize(-state.barWidth+state.barLeftMargin +state.barRightMargin);

  state.barSvg.select('g.tfp-bar-x-axis')
    .attr('transform', `translate(0, ${state.barHeight - state.barBottomMargin})`)
    .transition().duration(state.transDuration)
      .call(state.barXAxis)
    .selectAll("text")
      .attr("y", 0)
      .attr("x", -50)
      .attr("dy", ".35em")
      .attr("transform", "rotate(-90)");

  state.barSvg.select('g.tfp-bar-y-axis')
    .attr('transform', `translate(${state.barLeftMargin}, 0)`)
    .transition().duration(state.transDuration)
      .call(state.barYAxis);

  var l1 = state.barSvg.select('g.tfp-bar-graph')
    .selectAll('g')
    .data(stacked_data);

  l1.exit().remove();
  l1 = l1.enter().append('g').merge(l1).attr("fill", d => state.zColorMap.get(d.key));

  var l2 = l1.selectAll("rect").data(d=>d);

  l2.exit().remove(); 

  var newbars = l2.enter().append("rect")
    .attr('width', 0)
    .attr('height', 0)
    .attr('x', 0)
    .attr('y', 0)
    .style('fill-opacity', 0.8)
    .on('mouseover.barTooltip', state.barTooltip.show)
    .on('mouseout.barTooltip', state.barTooltip.hide);
    
  newbars
    .on('mouseover', function() {

      if (state.disableHover) { return; }

      //MoveToFront()(this);
      //const hoverEnlarge = state.lineHeight*hoverEnlargeRatio;

      const hoverEnlarge = state.barXScale.bandwidth()*0.02;

      //  const x = state.barXScale(d.data.worker);
      //  const y = state.barYScale(d[1]);
      //  const w = state.barXScale.bandwidth();
      //  const h = state.barYScale(d[0]) - state.barYScale(d[1]);
      d3.select(this)
        .transition().duration(250)
        .attr('x', function(d) {
          return state.barXScale(`${d.data.executor}+&+${d.data.worker}`)-hoverEnlarge/2; 
        })
        .attr('width', state.barXScale.bandwidth() + hoverEnlarge)
        .attr('y', function(d) {
          return state.barYScale(d[1]) - hoverEnlarge/2;
        })
        .attr('height', function(d) {
          return state.barYScale(d[0]) - state.barYScale(d[1]) + hoverEnlarge;
        })
        .style('fill-opacity', 1);
    })
    .on('mouseout', function() {
      d3.select(this)
        .transition().duration(250)
        .attr('width', d => state.barXScale.bandwidth())
        .attr('height', d => state.barYScale(d[0]) - state.barYScale(d[1]))
        .attr('x', d => state.barXScale(`${d.data.executor}+&+${d.data.worker}`))
        .attr('y', d => state.barYScale(d[1]))
        .style('fill-opacity', 0.8);
    })


  l2.merge(newbars)
    .transition().duration(state.transDuration)
    .attr('rx', 1)
    .attr('ry', 1)
    .attr('x', d => state.barXScale(`${d.data.executor}+&+${d.data.worker}`))
    .attr('y', d => state.barYScale(d[1]))
    .attr('height', d => state.barYScale(d[0]) - state.barYScale(d[1]))
    .attr('width', state.barXScale.bandwidth());
}

// ----------------------------------------------------------------------------
// private function definitions
// ----------------------------------------------------------------------------

// Procedure: _invertOrdinal 
// perform interpolation
function _invertOrdinal(type, cmpFunc) {

  cmpFunc = cmpFunc || function (a, b) {
      return (a >= b);
    };

  const scDomain = this.domain();
  let scRange = this.range();

  if (scRange.length === 2 && scDomain.length !== 2) {
    // Special case, interpolate range types
    scRange = d3.range(scRange[0], scRange[1], (scRange[1] - scRange[0]) / scDomain.length);
  }

  const bias = scRange[0];
  for (let i = 0, len = scRange.length; i < len; i++) {
    if (cmpFunc(scRange[i] + bias, type)) {
      return scDomain[Math.round(i * scDomain.length / scRange.length)];
    }
  }

  return this.domain()[this.domain().length-1];
}
  
function _make_tfp_gradient_field() {  

  //console.log("making gradient ...");
  state.executorGradId = `areaGradient${Math.round(Math.random()*10000)}`;
  const gradient = state.svg.append('linearGradient');

  gradient.attr('y1', '0%')
          .attr('y2', '100%')
          .attr('x1', '0%')
          .attr('x2', '0%')
          .attr('id', state.executorGradId);
  
  const color_scale = d3.scaleLinear().domain([0, 1]).range(['#FAFAFA', '#E0E0E0']);
  const stop_scale = d3.scaleLinear().domain([0, 100]).range(color_scale.domain());
  
  let color_stops = gradient.selectAll('stop')
                      .data(d3.range(0, 100.01, 20)); 

  color_stops.exit().remove();
  color_stops.merge(color_stops.enter().append('stop'))
    .attr('offset', d => `${d}%`)
    .attr('stop-color', d => color_scale(stop_scale(d)));
}

// Procedure: _make_tfp_date_marker_line
function _make_tfp_date_marker_line() {
  //console.log("making date marker ...");
  state.dateMarkerLine = state.svg.append('line').attr('class', 'x-axis-date-marker');
}

// Procedure: _make_tfp_overview
function _make_tfp_overview() {
  //console.log("making the overview ...");
  
  // overview svg
  state.overviewAreaSvg = state.dom.append('div').append('svg').attr('class', 'brusher');

  state.overviewAreaBrush
    .handleSize(24)
    .on('end', function() {
      
      //console.log("ON 'end': brush ends by source", d3.event.sourceEvent);
      if (!d3.event.sourceEvent) {
        return;
      }
      //console.log("    -> type:", d3.event.sourceEvent.type);

      const selection = d3.event.selection ? 
        d3.event.selection.map(state.overviewAreaScale.invert) : 
        state.overviewAreaScale.domain();

      // avoid infinite event loop
      if(d3.event.sourceEvent.type === "mouseup") {
        state.svg.dispatch('zoom', { detail: {
          zoomX: selection,
          zoomY: state.zoomY
        }});
      }
    });

  // Build dom
  const brusher = state.overviewAreaSvg.append('g').attr('class', 'brusher-margins');
  brusher.append('rect').attr('class', 'grid-background');
  brusher.append('g').attr('class', 'x-grid');
  brusher.append('g').attr('class', 'x-axis');
  brusher.append('g').attr('class', 'brush');
}

// Procedure: _make_tfp_bar
function _make_tfp_bar() {
  
  const barDiv = state.dom.append('div').attr('class', 'mt-4');
  const selDiv = barDiv.append('div').style('margin-left', `${state.barLeftMargin}px`)

  const exeSel = selDiv
    .append('select')
    .attr('id', 'tfp-bar-sel-executor')
    .attr('class', 'btn-secondary')
    .on('change', function() {
      const tt = d3.select("#tfp-bar-sel-task-type").node().value;
      update_bar(
        this.value === 'executor (all)' ? null : this.value,
        tt === 'task type (all)' ? null : tt
      );
    });

  selDiv.append('select')
    .attr('id', 'tfp-bar-sel-task-type')
    .attr('class', 'ml-2 btn-secondary')
    .on('change', function() {
      const exe = d3.select('#tfp-bar-sel-executor').node().value;
      update_bar(
        exe === 'executor (all)' ? null : exe,
        this.value === 'task type (all)' ? null : this.value
      );
    })
    .selectAll('option')
    .data(['task type (all)', ... Array.from(state.zColorMap.keys())])
    .enter().append('option')
    .text(d=>d);

  state.barSvg = barDiv.append('svg')
    .attr('width', state.barWidth)
    .attr('height', state.barHeight);

  state.barSvg.append('g').attr('class', 'tfp-bar-x-axis');
  state.barSvg.append('g').attr('class', 'tfp-bar-y-axis');
  state.barSvg.append('g').attr('class', 'tfp-bar-graph');
}

// Procedure: _make_tfp_axes
function _make_tfp_axes() {  
  //console.log("making the axes ...");
  const axes = state.svg.append('g').attr('class', 'axes');
  axes.append('g').attr('class', 'x-axis');
  axes.append('g').attr('class', 'x-grid');
  axes.append('g').attr('class', 'y-axis');
  axes.append('g').attr('class', 'grp-axis');

  state.yAxis.scale(state.yScale).tickSize(0);
  state.grpAxis.scale(state.grpScale).tickSize(0);
}

// Procedure: _make_tfp_legend
function _make_tfp_legend() {

  //console.log("making the legend ...");

  // add a reset text
  state.resetBtn = state.svg.append('text')
    .attr('class', 'reset-zoom-btn')
    .text('Reset Zoom')
    .on('click' , function() {
      //console.log("ON 'click': reset btn");
      state.svg.dispatch('resetZoom');
    });
  
  // add a legend 
  state.zScale = d3.scaleOrdinal()
    .domain(Array.from(state.zColorMap.keys()))
    .range(Array.from(state.zColorMap.values()));

  state.zGroup = state.svg.append('g')
                   .attr('class', 'legend');
  state.zWidth = (state.width-state.leftMargin-state.rightMargin)*3/4;
  state.zHeight = state.topMargin*0.8;

  const binWidth = state.zWidth / state.zScale.domain().length;

  //console.log(binWidth)

  let slot = state.zGroup.selectAll('.z-slot')
    .data(state.zScale.domain());

  slot.exit().remove();

  const newslot = slot.enter()
    .append('g')
    .attr('class', 'z-slot');

  newslot.append('rect')
    .attr('y', 0)
    .attr('rx', 0)
    .attr('ry', 0)
    .attr('stroke-width', 0);

  newslot.append('text')
    .style('text-anchor', 'middle')
    .style('dominant-baseline', 'central');

  // Update
  slot = slot.merge(newslot);

  slot.select('rect')
    .attr('width', binWidth)
    .attr('height', state.zHeight)
    .attr('x', (d, i) => binWidth*i)
    .attr('fill', d => state.zScale(d));

  slot.select('text')
    .text(d => d)
    .attr('x', (d, i) => binWidth*(i+.5))
    .attr('y', state.zHeight*0.5)
    .style('fill', '#FFFFFF');
}

// Procedure: _make_tfp_graph
function _make_tfp_graph() {

  //console.log("making the graph ...");

  state.graph = state.svg.append('g');

  state.graph.on('mousedown', function() {

    //console.log("ON 'mousedown'");

    if (d3.select(window).on('mousemove.zoomRect')!=null) // Selection already active
      return;

    const e = this;

    if (d3.mouse(e)[0]<0 || d3.mouse(e)[0] > state.graphW || 
        d3.mouse(e)[1]<0 || d3.mouse(e)[1] > state.graphH)
      return;

    state.disableHover=true;

    const rect = state.graph.append('rect')
      .attr('class', 'chart-zoom-selection');

    const startCoords = d3.mouse(e);

    d3.select(window)
      .on('mousemove.zoomRect', function() {

        //console.log("ON 'mousemove'");

        d3.event.stopPropagation();
        const newCoords = [
          Math.max(0, Math.min(state.graphW, d3.mouse(e)[0])),
          Math.max(0, Math.min(state.graphH, d3.mouse(e)[1]))
        ];

        rect.attr('x', Math.min(startCoords[0], newCoords[0]))
          .attr('y', Math.min(startCoords[1], newCoords[1]))
          .attr('width', Math.abs(newCoords[0] - startCoords[0]))
          .attr('height', Math.abs(newCoords[1] - startCoords[1]));

        state.overviewAreaSelection = [startCoords[0], newCoords[0]]
                                        .sort(d3.ascending)
                                        .map(state.xScale.invert);
        _render_overview_area();
        //state.svg.dispatch('zoomScent', { detail: {
        //  zoomX: [startCoords[0], newCoords[0]].sort(d3.ascending).map(state.xScale.invert),
        //  zoomY: [startCoords[1], newCoords[1]].sort(d3.ascending).map(d =>
        //    state.yScale.domain().indexOf(state.yScale.invert(d))
        //    + ((state.zoomY && state.zoomY[0])?state.zoomY[0]:0)
        //  )
        //}});
      })
      .on('mouseup.zoomRect', function() {

        //console.log("ON 'mouseup'");

        d3.select(window).on('mousemove.zoomRect', null).on('mouseup.zoomRect', null);
        d3.select('body').classed('stat-noselect', false);
        rect.remove();
        state.disableHover=false;

        const endCoords = [
          Math.max(0, Math.min(state.graphW, d3.mouse(e)[0])),
          Math.max(0, Math.min(state.graphH, d3.mouse(e)[1]))
        ];

        if (startCoords[0]==endCoords[0] && startCoords[1]==endCoords[1]) {
          //console.log("no change");
          return;
        }

        //console.log("coord", endCoords);

        const newDomainX = [startCoords[0], endCoords[0]].sort(d3.ascending).map(state.xScale.invert);

        const newDomainY = [startCoords[1], endCoords[1]].sort(d3.ascending).map(d =>
          state.yScale.domain().indexOf(state.yScale.invert(d))
          + ((state.zoomY && state.zoomY[0])?state.zoomY[0]:0)
        );
        
        state.svg.dispatch('zoom', { detail: {
          zoomX: newDomainX,
          zoomY: newDomainY
        }});
      }, true);

    d3.event.stopPropagation();
  });
}

// Procedure: _make_tfp_tooltips
function _make_tfp_tooltips() {

  //console.log("making the tooltips ...");
  
  // executor tooltips 
  state.executorTooltip = d3.tip()
       .attr('class', 'tfp-tooltip')
       .direction('w')
       .offset([0, 0])
       .html(d => {
         const leftPush = (d.hasOwnProperty('span') ?
                          state.xScale(d.span[0]) : 0);
         const topPush = (d.hasOwnProperty('worker') ?
                          state.grpScale(d.executor) - state.yScale(`${d.executor}+&+${d.worker}`) : 0 );
         state.executorTooltip.offset([topPush, -leftPush]);
         return d.executor;
       });

  state.svg.call(state.executorTooltip);

  // worker tooltips
  state.lineTooltip = d3.tip()
       .attr('class', 'tfp-tooltip')
       .direction('e')
       .offset([0, 0])
       .html(d => {
         const rightPush = (d.hasOwnProperty('span') ? 
                            state.xScale.range()[1]-state.xScale(d.span[1]) : 0);
         state.lineTooltip.offset([0, rightPush]);
         return d.worker;
       });

  state.svg.call(state.lineTooltip);
  
  // segment tooltips
  state.segmentTooltip = d3.tip()
    .attr('class', 'tfp-tooltip')
    .direction('s')
    .offset([5, 0])
    .html(d => {
      return `Type: ${d.type}<br>
              Name: ${d.name}<br>
              Span: [${d.span}]<br>
              Time: ${d.span[1]-d.span[0]}`;
    });

  state.svg.call(state.segmentTooltip);
  
  // bar tooltips
  state.barTooltip = d3.tip()
    .attr('class', 'tfp-tooltip')
    .direction('w')
    .offset([0, -5])
    .html(d => {
      //const p = ((d[1]-d[0]) * 100 / (state.maxX - state.minX)).toFixed(2);
      return `${d.data.executor}<br>
        ${d.data.worker}<br>
        Span: [${d[0]}, ${d[1]}]<br>
        Time: ${d[1]-d[0]}`;
    });

  state.svg.call(state.barTooltip);
}
      
// Proecedure: _make_tfp_events      
function _make_tfp_events() {

  //console.log("making dom events ...");

  state.svg.on('zoom', function() {

    const evData = d3.event.detail;   // passed custom parameters 
    const zoomX = evData.zoomX;
    const zoomY = evData.zoomY;
    //const redraw = (evData.redraw == null) ? true : evData.redraw;
    
    console.assert((zoomX && zoomY));
    //console.log("ON 'zoom'");

    update(zoomX, zoomY);
    
    // exposed to user
    //if (state.onZoom) {
    //  state.onZoom(state.zoomX, state.zoomY);
    //}
  });

  state.svg.on('resetZoom', function() {
    //console.log("ON resetZoom");
    update([state.minX, state.maxX], [null, null]);
    //if (state.onZoom) state.onZoom(null, null);
  });
}

// Procedure: _apply_filters
function _apply_filters() {

  // Flat data based on segment length
  //state.flatData = (state.minSegmentDuration>0
  //  ? state.completeFlatData.filter(d => (d.span[1]-d.span[0]) >= state.minSegmentDuration)
  //  : state.completeFlatData
  //);
  //state.flatData = state.completeFlatData;
  
  console.assert(state.zoomY);

  // zoomY
  //if (state.zoomY == null || state.zoomY==[null, null]) {
  if(state.zoomY == null || (state.zoomY[0] == null && state.zoomY[1] == null)) {
    //console.log("use all y");
    state.structData = state.completeStructData;
    state.nLines = state.totalNLines;
    //for (let i=0, len=state.structData.length; i<len; i++) {
    //  state.nLines += state.structData[i].lines.length;
    //}
    //console.log(state.nLines, state.totalNLines);
    return;
  }

  //console.log("filtering struct Data on ", state.zoomY[0], state.zoomY[1]);

  state.structData = [];
  const cntDwn = [state.zoomY[0] == null ? 0 : state.zoomY[0]]; // Initial threshold
  cntDwn.push(Math.max(
    0, (state.zoomY[1]==null ? state.totalNLines : state.zoomY[1]+1)-cntDwn[0])
  ); // Number of lines

  state.nLines = cntDwn[1];
  for (let i=0, len=state.completeStructData.length; i<len; i++) {

    let validLines = state.completeStructData[i].lines;

    if (cntDwn[0]>=validLines.length) { // Ignore whole executor (before start)
      cntDwn[0]-=validLines.length;
      continue;
    }
    const executorData = {
      executor: state.completeStructData[i].executor,
      lines: null
    };
    if (validLines.length-cntDwn[0]>=cntDwn[1]) {  // Last (or first && last) executor (partial)
      executorData.lines = validLines.slice(cntDwn[0],cntDwn[1]+cntDwn[0]);
      state.structData.push(executorData);
      cntDwn[1]=0;
      break;
    }
    if (cntDwn[0]>0) {  // First executor (partial)
      executorData.lines = validLines.slice(cntDwn[0]);
      cntDwn[0]=0;
    } else {  // Middle executor (full fit)
      executorData.lines = validLines;
    }

    state.structData.push(executorData);
    cntDwn[1]-=executorData.lines.length;
  }

  state.nLines-=cntDwn[1];
  //console.log("filtered lines:", state.nLines);
}


function _adjust_dimensions() {
  //console.log("adjusting up dimensions ... nLines =", state.nLines);
  state.graphW = state.width - state.leftMargin - state.rightMargin;
  state.graphH = state.nLines*state.maxLineHeight;
  state.height = state.graphH + state.topMargin + state.bottomMargin;
  //console.log("transition to", state.width, state.height, " graph", state.graphH, state.graphW);
  state.svg//.transition().duration(state.transDuration)
    .attr('width', state.width)
    .attr('height', state.height);

  state.graph.attr('transform', `translate(${state.leftMargin}, ${state.topMargin})`);
}

function _adjust_xscale() {
  console.assert(state.zoomX[0] && state.zoomX[1]);
  //console.log("adjusting xscale to", state.zoomX);
  state.xScale.domain(state.zoomX)
              .range([0, state.graphW])
              .clamp(true);
}

// Procedure: _adjust_yscale
function _adjust_yscale() {

  let workers = [];
  for (let i= 0, len=state.structData.length; i<len; i++) {
    workers = workers.concat(state.structData[i].lines.map(function (d) {
      return `${state.structData[i].executor}+&+${d}`
    }));
  }

  //console.log("adjusting yscale to", workers);
  state.yScale.domain(workers);
  //console.log(state.graphH/workers.length*0.5, state.graphH*(1-0.5/workers.length));
  state.yScale.range([state.graphH/workers.length*0.5, state.graphH*(1-0.5/workers.length)]);
}
    
// Procedure: _adjust_grpscale
function _adjust_grpscale() {
  //console.log("adjusting executor domain", state.structData.map(d => d.executor));
  state.grpScale.domain(state.structData.map(d => d.executor));

  let cntLines = 0;

  state.grpScale.range(state.structData.map(d => {
    const pos = (cntLines + d.lines.length/2)/state.nLines*state.graphH;
    cntLines += d.lines.length;
    return pos;
  }));
}

// Procedure: _adjust_legend
function _adjust_legend() {
  //console.log("adjusting legend ...");
  state.resetBtn//.transition().duration(state.transDuration)
    .attr('x', state.leftMargin + state.graphW*.99)
    .attr('y', state.topMargin *.8);
  
  state.zGroup//.transition().duration(state.transDuration)
    .attr('transform', `translate(${state.leftMargin}, ${state.topMargin * .1})`);
}

// Procedure: _render_axes
function _render_axes() {

  state.svg.select('.axes')
    .attr('transform', `translate(${state.leftMargin}, ${state.topMargin})`);

  // X
  const nXTicks = num_xticks(state.graphW);

  //console.log("rendering axes nXTicks =", nXTicks);

  state.xAxis
    .scale(state.xScale)
    .ticks(nXTicks);

  state.xGrid
    .scale(state.xScale)
    .ticks(nXTicks)
    .tickFormat('');

  state.svg.select('g.x-axis')
    .style('stroke-opacity', 0)
    .style('fill-opacity', 0)
    .attr('transform', `translate(0, ${state.graphH})`)
    .transition().duration(state.transDuration)
      .call(state.xAxis)
      .style('stroke-opacity', 1)
      .style('fill-opacity', 1);

  /* Angled x axis workers
   state.svg.select('g.x-axis').selectAll('text')
   .style('text-anchor', 'end')
   .attr('transform', 'translate(-10, 3) rotate(-60)');
   */

  state.xGrid.tickSize(state.graphH);
  state.svg.select('g.x-grid')
    .attr('transform', `translate(0, ${state.graphH})`)
    .transition().duration(state.transDuration)
    .call(state.xGrid);

  if (
    state.dateMarker &&
    state.dateMarker >= state.xScale.domain()[0] &&
    state.dateMarker <= state.xScale.domain()[1]
  ) {
    state.dateMarkerLine
      .style('display', 'block')
      .transition().duration(state.transDuration)
        .attr('x1', state.xScale(state.dateMarker) + state.leftMargin)
        .attr('x2', state.xScale(state.dateMarker) + state.leftMargin)
        .attr('y1', state.topMargin + 1)
        .attr('y2', state.graphH + state.topMargin)
  } else {
    state.dateMarkerLine.style('display', 'none');
  }

  // Y
  const fontVerticalMargin = 0.6;
  const workerDisplayRatio = Math.ceil(
    state.nLines*state.minLabelFont/Math.SQRT2/state.graphH/fontVerticalMargin
  );
  const tickVals = state.yScale.domain().filter((d, i) => !(i % workerDisplayRatio));
  let fontSize = Math.min(14, state.graphH/tickVals.length*fontVerticalMargin*Math.SQRT2);
  let maxChars = Math.ceil(state.rightMargin/(fontSize/Math.SQRT2));

  state.yAxis.tickValues(tickVals);
  state.yAxis.tickFormat(d => reduceLabel(d.split('+&+')[1], maxChars));
  state.svg.select('g.y-axis')
    .transition().duration(state.transDuration)
      .attr('transform', `translate(${state.graphW}, 0)`)
      .attr('font-size', `${fontSize}px`)
      .call(state.yAxis);

  // Grp
  const minHeight = d3.min(state.grpScale.range(), function (d, i) {
    return i>0 ? d-state.grpScale.range()[i-1] : d*2;
  });

  fontSize = Math.min(14, minHeight*fontVerticalMargin*Math.SQRT2);
  maxChars = Math.ceil(state.leftMargin/(fontSize/Math.SQRT2));
  
  //console.log(minHeight, maxChars, fontSize);

  state.grpAxis.tickFormat(d => reduceLabel(d, maxChars));
  state.svg.select('g.grp-axis')
    .transition().duration(state.transDuration)
    .attr('font-size', `${fontSize}px`)
    .call(state.grpAxis);

  //// Make Axises clickable
  //if (state.onLabelClick) {
  //  console.log("register callback")
  //  state.svg.selectAll('g.y-axis,g.grp-axis').selectAll('text')
  //    .style('cursor', 'pointer')
  //    .on('click', function(d) {
  //      const segms = d.split('+&+');
  //      //state.onLabelClick(...segms.reverse());
  //      console.log("click on", d);
  //    });
  //}


}

// Procedure: _render_executors
function _render_executors() {

  let executors = state.graph.selectAll('rect.series-executor').data(state.structData, d => d.executor);
  //console.log("rendering executors", executors);
      
  executors.exit()
    .transition().duration(state.transDuration)
    .style('stroke-opacity', 0)
    .style('fill-opacity', 0)
    .remove();

  const newGroups = executors.enter().append('rect')
    .attr('class', 'series-executor')
    .attr('x', 0)
    .attr('y', 0)
    .attr('height', 0)
    .style('fill', `url(#${state.executorGradId})`)
    .on('mouseover', state.executorTooltip.show)
    .on('mouseout', state.executorTooltip.hide);

  newGroups.append('title')
    .text('click-drag to zoom in');

  executors = executors.merge(newGroups);

  executors.transition().duration(state.transDuration)
    .attr('width', state.graphW)
    .attr('height', function (d) {
      return state.graphH*d.lines.length/state.nLines;
    })
    .attr('y', function (d) {
      return state.grpScale(d.executor)-state.graphH*d.lines.length/state.nLines/2;
    });
}

// procedure: _render_timelines
function _render_timelines(maxElems) {

  //console.log("rendering timelines ...");

  if (maxElems == undefined || maxElems < 0) {
    maxElems = null;
  }

  const hoverEnlargeRatio = .4;

  const dataFilter = (d, i) =>
    (maxElems == null || i<maxElems) &&
    (state.grpScale.domain().indexOf(d.executor)+1 &&
     d.span[1]>=state.xScale.domain()[0] &&
     d.span[0]<=state.xScale.domain()[1] &&
     state.yScale.domain().indexOf(`${d.executor}+&+${d.worker}`)+1);

  state.lineHeight = state.graphH/state.nLines*0.8;

  let timelines = state.graph.selectAll('rect.series-segment').data(
    //state.flatData.filter(dataFilter),
    state.completeFlatData.filter(dataFilter),
    d => d.executor + d.worker + d.type + d.span[0]
  );

  timelines.exit().remove();
    //.transition().duration(state.transDuration)
    //.style('fill-opacity', 0)
    //.remove();

  const newSegments = timelines.enter().append('rect')
    .attr('class', 'series-segment')
    .attr('rx', 1)
    .attr('ry', 1)
    .attr('x', state.graphW/2)    // here we initialize the rect to avoid
    .attr('y', state.graphH/2)    // NaN y error during transition
    .attr('width', 0)
    .attr('height', 0)
    .style('fill-opacity', 0)
    .style('fill', d => state.zColorMap.get(d.type))
    .on('mouseover.executorTooltip', state.executorTooltip.show)
    .on('mouseout.executorTooltip', state.executorTooltip.hide)
    .on('mouseover.lineTooltip', state.lineTooltip.show)
    .on('mouseout.lineTooltip', state.lineTooltip.hide)
    .on('mouseover.segmentTooltip', state.segmentTooltip.show)
    .on('mouseout.segmentTooltip', state.segmentTooltip.hide);

  newSegments
    .on('mouseover', function() {

      if (state.disableHover) { return; }

      //MoveToFront()(this);

      const hoverEnlarge = state.lineHeight*hoverEnlargeRatio;

      d3.select(this)
        .transition().duration(250)
        .attr('x', function (d) {
          return state.xScale(d.span[0])-hoverEnlarge/2;
        })
        .attr('width', function (d) {
          return d3.max([1, state.xScale(d.span[1])-state.xScale(d.span[0])])+hoverEnlarge;
        })
        .attr('y', function (d) {
          return state.yScale(`${d.executor}+&+${d.worker}`)-(state.lineHeight+hoverEnlarge)/2;
        })
        .attr('height', state.lineHeight+hoverEnlarge)
        .style('fill-opacity', 1);
    })
    .on('mouseout', function() {
      d3.select(this)
        .transition().duration(250)
        .attr('x', function (d) {
          return state.xScale(d.span[0]);
        })
        .attr('width', function (d) {
          return d3.max([1, state.xScale(d.span[1])-state.xScale(d.span[0])]);
        })
        .attr('y', function (d) {
          return state.yScale(`${d.executor}+&+${d.worker}`)-state.lineHeight/2;
        })
        .attr('height', state.lineHeight)
        .style('fill-opacity', .8);
    })
    .on('click', function (s) {
      if (state.onSegmentClick)
        state.onSegmentClick(s);
    });

  timelines = timelines.merge(newSegments);

  timelines.transition().duration(state.transDuration)
    .attr('x', function (d) {
      return state.xScale(d.span[0]);
    })
    .attr('width', function (d) {
      return d3.max([1, state.xScale(d.span[1])-state.xScale(d.span[0])]);
    })
    .attr('y', function (d) {
      return state.yScale(`${d.executor}+&+${d.worker}`)-state.lineHeight/2;
    })
    .attr('height', state.lineHeight)
    .style('fill-opacity', .8);
}

function _render_overview_area()  {

  //console.log("rendering overview...")
  
  // domain is not set up yet
  if (state.overviewAreaDomain[0] == null || state.overviewAreaDomain[1] == null) {
    return;
  }

  const brushWidth = state.graphW;
  const brushHeight = 20;
  const nXTicks = num_xticks(brushWidth);

  //console.log("brush ", brushWidth, brushHeight);

  state.overviewAreaScale
    .domain(state.overviewAreaDomain)
    .range([0, brushWidth]);

  state.overviewAreaXAxis
    .scale(state.overviewAreaScale)
    .ticks(nXTicks);

  state.overviewAreaXGrid
    .scale(state.overviewAreaScale)
    .tickSize(-brushHeight);

  state.overviewAreaSvg
    .attr('width', state.width)
    .attr('height', brushHeight + state.overviewAreaTopMargin
                                + state.overviewAreaBottomMargin);

  state.overviewAreaSvg.select('.brusher-margins')
    .attr('transform', `translate(${state.leftMargin}, ${state.overviewAreaTopMargin})`);

  state.overviewAreaSvg.select('.grid-background')
    //.attr('transform', `translate(${state.leftMargin},${})`)
    .attr('width', brushWidth)
    .attr('height', brushHeight);

  state.overviewAreaSvg.select('.x-grid')
    .attr('transform', `translate(0, ${brushHeight})`)
    .call(state.overviewAreaXGrid);

  state.overviewAreaSvg.select('.x-axis')
    .attr("transform", `translate(0, ${brushHeight})`)
    .call(state.overviewAreaXAxis)
    .selectAll('text').attr('y', 8);

  state.overviewAreaSvg.select('.brush')
    .call(state.overviewAreaBrush.extent([[0, 0], [brushWidth, brushHeight]]))
    .call(state.overviewAreaBrush.move, state.overviewAreaSelection.map(state.overviewAreaScale));
}


// ----------------------------------------------------------------------------
// Helper functions
// ----------------------------------------------------------------------------
function num_xticks(W) {
  return Math.max(2, Math.min(12, Math.round(W * 0.012)));
}
  
function reduceLabel(worker, maxChars) {
  return worker.length <= maxChars ? worker : (
    worker.substring(0, maxChars*2/3)
    + '...'
    + worker.substring(worker.length - maxChars/3, worker.length
  ));
}

// ----------------------------------------------------------------------------
// ----------------------------------------------------------------------------

// Example: Matrix multiplication
$('#tfp_matmul').on('click', function() {
  tfp_render_matmul();
})

$('#tfp_kmeans').on('click', function() {
  tfp_render_kmeans();
})

$('#tfp_inference').on('click', function() {
  tfp_render_inference();
})

$('#tfp_dreamplace').on('click', function() {
  tfp_render_dreamplace();
})

// textarea changer event
$('#tfp_textarea').on('input propertychange paste', function() {

  if($(this).data('timeout')) {
    clearTimeout($(this).data('timeout'));
  }

  $(this).data('timeout', setTimeout(()=>{
    
    var text = $('#tfp_textarea').val().trim();
    
    $('#tfp_textarea').removeClass('is-invalid');

    if(!text) {
      return;
    }
    
    try {
      var json = JSON.parse(text);
      //console.log(json);
      feed(json);
    }
    catch(e) {
      $('#tfp_textarea').addClass('is-invalid');
      console.error(e);
    }

  }, 2000));
});

function tfp_render_simple() {
  feed(simple);
  $('#tfp_textarea').text(JSON.stringify(simple, null, 2));
}

function tfp_render_matmul() {
  feed(matmul);
  $('#tfp_textarea').text(JSON.stringify(matmul));
}

function tfp_render_kmeans() {
  feed(kmeans);
  $('#tfp_textarea').text(JSON.stringify(kmeans));
}

function tfp_render_inference() {
  feed(inference);
  $('#tfp_textarea').text(JSON.stringify(inference))
}

function tfp_render_dreamplace() {
  feed(dreamplace);
  $('#tfp_textarea').text(JSON.stringify(dreamplace))
}

// ----------------------------------------------------------------------------

// DOM objects
make_tfp_structure();

tfp_render_simple();









