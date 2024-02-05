# Architecture Visualization & Analysis (ARVISAN) backend

This is the backend for the proof-of-concept architecture
visualizer and analysis tool for the graduation project of Roy Kakkenberg.

## Requirements
This backend has been built with NodeJS 20.
Dependencies are installed with pnpm.

### Database
Because the tool outputs a graph, a relation database is required.
In this case, an instance of Neo4j is used as a database.
The backend only reads the data; it does not do any insertions.
Therefore, you have to add any data to the database yourself.

Then, the backend also requires a certain database structure.
First, all the nodes should be layered.
During development, the following layers (from top to bottom) and have been used:

- Domain
- Application
- (optionally one of Layer_Core, Layer_Enduser, Layer_Foundation)
- One of sublayer_Enduser, sublayer_Core, sublayer_API, sublayer_CompositeLogic, sublayer_CoreService, sublayer_CoreWidgets
sublayer_Foundation, sublayer_StyleGuide, sublayer_FoundationService, sublayer_Library*
- Module

_* Labels should only contain alphanumerical characters within the limitations of Neo4j. If a label contains an underscore,
this will be interpreted as a "class" of nodes within the layer._

The hierarchical tree-like structure should always have a top layer with only "Domain" nodes.
There should __not__ be a single root node that contains all "Domain" nodes (i.e. the domain layer
(top layer) is not contained by any other layers).
Every layer should be linked to the layer above with a relationship with the "CONTAINS" label.
A sublayer should always be contained by the layer above. It can have a different class.

There is exactly one layer label for each sublayer. In the end, all leaf nodes in the hierarchical
structure should be contained in all the layers.

Dependencies should only exist on the lower "Module" layer.
These relationships can have any label, but during testing the labels CALLS, USES, RENDERS, and CATCHES were used.

During development and testing, data has been imported using a custom parser.
Due to security and intellectual property considerations, this repository shall not be published. 